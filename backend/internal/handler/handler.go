package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"strings"
	"time"

	"studyplan/backend/internal/model"
)

type Store interface {
	Ping(context.Context) error
	ReplacePlan(context.Context, []model.PlanItem) error
	ListPlan(context.Context) ([]model.PlanItem, error)
	PlanSummary(context.Context) (model.PlanSummary, error)
	NextPlanItem(context.Context) (*model.PlanItem, error)
	UpdatePlanItemStatus(context.Context, string, bool) (model.PlanItem, error)
	CreateTitle(context.Context, string) (model.Title, error)
	ListTitles(context.Context) ([]model.Title, error)
	GetTitle(context.Context, string) (model.Title, error)
	UpdateTitle(context.Context, string, string) (model.Title, error)
	DeleteTitle(context.Context, string) error
	TitleExists(context.Context, string) (bool, error)
	GetFile(context.Context, string) (model.StudyFile, error)
	GetFileByTitleAndFilename(context.Context, string, string) (model.StudyFile, error)
	AddFile(context.Context, model.StudyFile) (model.StudyFile, error)
	UpdateFile(context.Context, model.StudyFile) (model.StudyFile, error)
	DeleteFile(context.Context, string) error
	ListFiles(context.Context, string) ([]model.StudyFile, error)
}

type ObjectStore interface {
	Ping(context.Context) error
	PutMarkdown(context.Context, string, string, string, io.Reader) (string, error)
	GetMarkdown(context.Context, string) (io.ReadCloser, error)
}

var (
	errInvalidMarkdownFile   = errors.New("only markdown files are allowed")
	errDuplicateMarkdownFile = errors.New("markdown file already exists")
)

type titleExport struct {
	title model.Title
	files []model.StudyFile
}

type Cache interface {
	Get(ctx context.Context, key string, target any) error
	Set(ctx context.Context, key string, value any, expiration time.Duration) error
	Delete(ctx context.Context, keys ...string) error
	Ping(ctx context.Context) error
}

type Handler struct {
	store       Store
	objects     ObjectStore
	cache       Cache
	logger      *slog.Logger
	maxUpload   int64
	healthLimit time.Duration
}

func New(store Store, objects ObjectStore, cache Cache, logger *slog.Logger) *Handler {
	return &Handler{store: store, objects: objects, cache: cache, logger: logger, maxUpload: 32 << 20, healthLimit: 5 * time.Second}
}

func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/study/", h.loggingMiddleware(h.corsMiddleware(http.HandlerFunc(h.route))))
	return mux
}

func (h *Handler) route(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSuffix(r.URL.Path, "/")
	if path == "" {
		path = "/"
	}

	switch {
	case r.Method == http.MethodGet && path == "/study/health":
		h.health(w, r)
	case r.Method == http.MethodPost && path == "/study/plan":
		h.replacePlan(w, r)
	case r.Method == http.MethodGet && path == "/study/plan":
		h.getPlan(w, r)
	case r.Method == http.MethodGet && path == "/study/plan/status":
		h.getPlanStatus(w, r)
	case r.Method == http.MethodGet && path == "/study/plan/next":
		h.getNextPlanItem(w, r)
	case r.Method == http.MethodPatch && strings.HasPrefix(path, "/study/plan/items/") && strings.HasSuffix(path, "/status"):
		h.updatePlanItemStatus(w, r, path)
	case r.Method == http.MethodPost && path == "/study/titles":
		h.createTitle(w, r)
	case r.Method == http.MethodGet && path == "/study/titles":
		h.listTitles(w, r)
	case r.Method == http.MethodGet && path == "/study/export":
		h.exportAllTitles(w, r)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/study/titles/") && !strings.Contains(strings.TrimPrefix(path, "/study/titles/"), "/"):
		h.getTitle(w, r, strings.TrimPrefix(path, "/study/titles/"))
	case r.Method == http.MethodPatch && strings.HasPrefix(path, "/study/titles/") && !strings.Contains(strings.TrimPrefix(path, "/study/titles/"), "/"):
		h.updateTitle(w, r, strings.TrimPrefix(path, "/study/titles/"))
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/study/titles/") && !strings.Contains(strings.TrimPrefix(path, "/study/titles/"), "/"):
		h.deleteTitle(w, r, strings.TrimPrefix(path, "/study/titles/"))
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/study/titles/") && strings.HasSuffix(path, "/export"):
		h.exportTitle(w, r, path)
	case r.Method == http.MethodPost && strings.HasPrefix(path, "/study/titles/") && strings.HasSuffix(path, "/files"):
		h.uploadFiles(w, r, path)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/study/titles/") && strings.HasSuffix(path, "/files"):
		h.listFiles(w, r, path)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/study/files/") && strings.HasSuffix(path, "/content"):
		h.getFileContent(w, r, path)
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/study/files/") && !strings.Contains(strings.TrimPrefix(path, "/study/files/"), "/"):
		h.deleteFile(w, r, strings.TrimPrefix(path, "/study/files/"))
	default:
		writeError(w, http.StatusNotFound, "route not found")
	}
}

func (h *Handler) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), h.healthLimit)
	defer cancel()

	pgErr := h.store.Ping(ctx)
	ossErr := h.objects.Ping(ctx)
	redisErr := h.cache.Ping(ctx)
	status := http.StatusOK
	response := map[string]any{"status": "ok", "postgres": "ok", "oss": "ok", "redis": "ok"}
	if pgErr != nil {
		h.logger.Error("health check postgres failed", "error", pgErr)
		response["status"] = "degraded"
		response["postgres"] = pgErr.Error()
		status = http.StatusServiceUnavailable
	}
	if ossErr != nil {
		h.logger.Error("health check oss failed", "error", ossErr)
		response["status"] = "degraded"
		response["oss"] = ossErr.Error()
		status = http.StatusServiceUnavailable
	}
	if redisErr != nil {
		h.logger.Error("health check redis failed", "error", redisErr)
		response["status"] = "degraded"
		response["redis"] = redisErr.Error()
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, response)
}

func (h *Handler) replacePlan(w http.ResponseWriter, r *http.Request) {
	var items []model.PlanItem
	if err := readJSON(r, &items); err != nil {
		h.logger.Warn("invalid replace plan payload", "error", err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(items) == 0 {
		writeError(w, http.StatusBadRequest, "plan must include at least one item")
		return
	}
	for i := range items {
		items[i].Content = strings.TrimSpace(items[i].Content)
		if items[i].Content == "" {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("content is required at index %d", i))
			return
		}
	}
	if err := h.store.ReplacePlan(r.Context(), items); err != nil {
		h.logger.Error("replace plan failed", "error", err)
		writeError(w, http.StatusInternalServerError, "replace plan failed")
		return
	}

	if err := h.cache.Delete(r.Context(), "study:plan", "study:plan:status", "study:plan:next"); err != nil {
		h.logger.Warn("invalidate plan cache failed", "error", err)
	}

	writeJSON(w, http.StatusCreated, map[string]any{"message": "plan saved", "count": len(items)})
}

func (h *Handler) getPlan(w http.ResponseWriter, r *http.Request) {
	var items []model.PlanItem
	key := "study:plan"
	if err := h.cache.Get(r.Context(), key, &items); err == nil {
		writeJSON(w, http.StatusOK, items)
		return
	}

	items, err := h.store.ListPlan(r.Context())
	if err != nil {
		h.logger.Error("list plan failed", "error", err)
		writeError(w, http.StatusInternalServerError, "list plan failed")
		return
	}

	if err := h.cache.Set(r.Context(), key, items, 1*time.Hour); err != nil {
		h.logger.Warn("cache plan failed", "error", err)
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) getPlanStatus(w http.ResponseWriter, r *http.Request) {
	var summary model.PlanSummary
	key := "study:plan:status"
	if err := h.cache.Get(r.Context(), key, &summary); err == nil {
		writeJSON(w, http.StatusOK, summary)
		return
	}

	summary, err := h.store.PlanSummary(r.Context())
	if err != nil {
		h.logger.Error("get plan status failed", "error", err)
		writeError(w, http.StatusInternalServerError, "get plan status failed")
		return
	}

	if err := h.cache.Set(r.Context(), key, summary, 1*time.Hour); err != nil {
		h.logger.Warn("cache plan status failed", "error", err)
	}
	writeJSON(w, http.StatusOK, summary)
}

func (h *Handler) getNextPlanItem(w http.ResponseWriter, r *http.Request) {
	var item *model.PlanItem
	key := "study:plan:next"
	if err := h.cache.Get(r.Context(), key, &item); err == nil {
		if item == nil {
			writeJSON(w, http.StatusOK, map[string]any{"item": nil, "message": "all plan items completed"})
		} else {
			writeJSON(w, http.StatusOK, item)
		}
		return
	}

	item, err := h.store.NextPlanItem(r.Context())
	if err != nil {
		h.logger.Error("get next plan item failed", "error", err)
		writeError(w, http.StatusInternalServerError, "get next plan item failed")
		return
	}

	if err := h.cache.Set(r.Context(), key, item, 1*time.Hour); err != nil {
		h.logger.Warn("cache next plan item failed", "error", err)
	}

	if item == nil {
		writeJSON(w, http.StatusOK, map[string]any{"item": nil, "message": "all plan items completed"})
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h *Handler) updatePlanItemStatus(w http.ResponseWriter, r *http.Request, path string) {
	id := strings.TrimSuffix(strings.TrimPrefix(path, "/study/plan/items/"), "/status")
	var body struct {
		Status *bool `json:"status"`
	}
	if err := readJSON(r, &body); err != nil {
		h.logger.Warn("invalid plan item status payload", "id", id, "error", err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.Status == nil {
		h.logger.Warn("missing plan item status", "id", id)
		writeError(w, http.StatusBadRequest, "status must be true or false")
		return
	}
	item, err := h.store.UpdatePlanItemStatus(r.Context(), id, *body.Status)
	if errors.Is(err, model.ErrNotFound) {
		writeError(w, http.StatusNotFound, "plan item not found")
		return
	}
	if err != nil {
		h.logger.Error("update plan item status failed", "id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "update plan item status failed")
		return
	}

	if err := h.cache.Delete(r.Context(), "study:plan", "study:plan:status", "study:plan:next"); err != nil {
		h.logger.Warn("invalidate plan cache after status update failed", "id", id, "error", err)
	}

	writeJSON(w, http.StatusOK, item)
}

func (h *Handler) createTitle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	title, err := h.store.CreateTitle(r.Context(), name)
	if err != nil {
		h.logger.Error("create title failed", "name", name, "error", err)
		writeError(w, http.StatusInternalServerError, "create title failed")
		return
	}

	if err := h.cache.Delete(r.Context(), "study:titles"); err != nil {
		h.logger.Warn("invalidate titles cache after create failed", "error", err)
	}

	writeJSON(w, http.StatusCreated, title)
}

func (h *Handler) listTitles(w http.ResponseWriter, r *http.Request) {
	var titles []model.Title
	key := "study:titles"
	if err := h.cache.Get(r.Context(), key, &titles); err == nil {
		writeJSON(w, http.StatusOK, titles)
		return
	}

	titles, err := h.store.ListTitles(r.Context())
	if err != nil {
		h.logger.Error("list titles failed", "error", err)
		writeError(w, http.StatusInternalServerError, "list titles failed")
		return
	}

	if err := h.cache.Set(r.Context(), key, titles, 1*time.Hour); err != nil {
		h.logger.Warn("cache titles failed", "error", err)
	}
	writeJSON(w, http.StatusOK, titles)
}

func (h *Handler) getTitle(w http.ResponseWriter, r *http.Request, id string) {
	var title model.Title
	key := fmt.Sprintf("study:titles:%s", id)
	if err := h.cache.Get(r.Context(), key, &title); err == nil {
		writeJSON(w, http.StatusOK, title)
		return
	}

	title, err := h.store.GetTitle(r.Context(), id)
	if errors.Is(err, model.ErrNotFound) {
		writeError(w, http.StatusNotFound, "title not found")
		return
	}
	if err != nil {
		h.logger.Error("get title failed", "id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "get title failed")
		return
	}

	if err := h.cache.Set(r.Context(), key, title, 1*time.Hour); err != nil {
		h.logger.Warn("cache title failed", "id", id, "error", err)
	}
	writeJSON(w, http.StatusOK, title)
}

func (h *Handler) updateTitle(w http.ResponseWriter, r *http.Request, id string) {
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	title, err := h.store.UpdateTitle(r.Context(), id, name)
	if errors.Is(err, model.ErrNotFound) {
		writeError(w, http.StatusNotFound, "title not found")
		return
	}
	if err != nil {
		h.logger.Error("update title failed", "id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "update title failed")
		return
	}

	if err := h.cache.Delete(r.Context(), "study:titles", fmt.Sprintf("study:titles:%s", id)); err != nil {
		h.logger.Warn("invalidate titles cache after update failed", "id", id, "error", err)
	}

	writeJSON(w, http.StatusOK, title)
}

func (h *Handler) deleteTitle(w http.ResponseWriter, r *http.Request, id string) {
	if err := h.store.DeleteTitle(r.Context(), id); errors.Is(err, model.ErrNotFound) {
		writeError(w, http.StatusNotFound, "title not found")
		return
	} else if err != nil {
		h.logger.Error("delete title failed", "id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "delete title failed")
		return
	}

	if err := h.cache.Delete(r.Context(), "study:titles", fmt.Sprintf("study:titles:%s", id), fmt.Sprintf("study:titles:%s:files", id)); err != nil {
		h.logger.Warn("invalidate titles cache after delete failed", "id", id, "error", err)
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "title deleted"})
}

func (h *Handler) exportTitle(w http.ResponseWriter, r *http.Request, requestPath string) {
	titleID := strings.TrimSuffix(strings.TrimPrefix(requestPath, "/study/titles/"), "/export")
	title, err := h.store.GetTitle(r.Context(), titleID)
	if errors.Is(err, model.ErrNotFound) {
		writeError(w, http.StatusNotFound, "title not found")
		return
	}
	if err != nil {
		h.logger.Error("get title before export failed", "title_id", titleID, "error", err)
		writeError(w, http.StatusInternalServerError, "get title failed")
		return
	}

	files, err := h.store.ListFiles(r.Context(), titleID)
	if err != nil {
		h.logger.Error("list files before export failed", "title_id", titleID, "error", err)
		writeError(w, http.StatusInternalServerError, "list files failed")
		return
	}
	if len(files) == 0 {
		writeError(w, http.StatusNotFound, "no markdown files to export")
		return
	}

	root := safeArchiveName(title.Name)
	buf, err := h.buildExportZip(r.Context(), []titleExport{{title: title, files: files}})
	if err != nil {
		h.logger.Error("build title export failed", "title_id", titleID, "error", err)
		writeError(w, http.StatusInternalServerError, "create export failed")
		return
	}

	downloadName := root + ".zip"
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", contentDisposition(downloadName))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(buf)))
	if _, err := w.Write(buf); err != nil {
		h.logger.Error("stream zip failed", "title_id", titleID, "error", err)
	}
}

func (h *Handler) exportAllTitles(w http.ResponseWriter, r *http.Request) {
	titles, err := h.store.ListTitles(r.Context())
	if err != nil {
		h.logger.Error("list titles before export all failed", "error", err)
		writeError(w, http.StatusInternalServerError, "list titles failed")
		return
	}

	exports := make([]titleExport, 0, len(titles))
	totalFiles := 0
	for _, title := range titles {
		files, err := h.store.ListFiles(r.Context(), title.ID)
		if err != nil {
			h.logger.Error("list files before export all failed", "title_id", title.ID, "error", err)
			writeError(w, http.StatusInternalServerError, "list files failed")
			return
		}
		if len(files) == 0 {
			continue
		}
		totalFiles += len(files)
		exports = append(exports, titleExport{title: title, files: files})
	}
	if totalFiles == 0 {
		writeError(w, http.StatusNotFound, "no markdown files to export")
		return
	}

	buf, err := h.buildExportZip(r.Context(), exports)
	if err != nil {
		h.logger.Error("build all titles export failed", "error", err)
		writeError(w, http.StatusInternalServerError, "create export failed")
		return
	}

	downloadName := "study-notes.zip"
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", contentDisposition(downloadName))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(buf)))
	if _, err := w.Write(buf); err != nil {
		h.logger.Error("stream all titles zip failed", "error", err)
	}
}

func (h *Handler) buildExportZip(ctx context.Context, exports []titleExport) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	usedDirs := make(map[string]int)

	for _, item := range exports {
		root := uniqueArchiveName(safeArchiveName(item.title.Name), usedDirs)
		usedFiles := make(map[string]int)
		for _, file := range item.files {
			rc, err := h.objects.GetMarkdown(ctx, file.OSSKey)
			if err != nil {
				_ = zw.Close()
				return nil, fmt.Errorf("fetch markdown %s: %w", file.ID, err)
			}

			entryName := path.Join(root, uniqueArchiveFilename(file.Filename, usedFiles))
			entry, err := zw.Create(entryName)
			if err != nil {
				_ = rc.Close()
				_ = zw.Close()
				return nil, fmt.Errorf("create zip entry %s: %w", entryName, err)
			}
			if _, err := io.Copy(entry, rc); err != nil {
				_ = rc.Close()
				_ = zw.Close()
				return nil, fmt.Errorf("write zip entry %s: %w", entryName, err)
			}
			if err := rc.Close(); err != nil {
				h.logger.Warn("close markdown reader failed", "file_id", file.ID, "error", err)
			}
		}
	}

	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("close zip writer: %w", err)
	}
	return buf.Bytes(), nil
}

func (h *Handler) uploadFiles(w http.ResponseWriter, r *http.Request, path string) {
	titleID := strings.TrimSuffix(strings.TrimPrefix(path, "/study/titles/"), "/files")
	exists, err := h.store.TitleExists(r.Context(), titleID)
	if err != nil {
		h.logger.Error("check title before upload failed", "title_id", titleID, "error", err)
		writeError(w, http.StatusInternalServerError, "check title failed")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "title not found")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, h.maxUpload)
	if err := r.ParseMultipartForm(h.maxUpload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form or upload too large")
		return
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "multipart field files is required")
		return
	}
	overwrite := strings.EqualFold(r.URL.Query().Get("overwrite"), "true")
	if !overwrite {
		seen := make(map[string]struct{}, len(files))
		for _, header := range files {
			if _, ok := seen[header.Filename]; ok {
				writeError(w, http.StatusConflict, fmt.Sprintf("%s: %s", errDuplicateMarkdownFile, header.Filename))
				return
			}
			seen[header.Filename] = struct{}{}
			if _, err := h.store.GetFileByTitleAndFilename(r.Context(), titleID, header.Filename); err == nil {
				writeError(w, http.StatusConflict, fmt.Sprintf("%s: %s", errDuplicateMarkdownFile, header.Filename))
				return
			} else if !errors.Is(err, model.ErrNotFound) {
				h.logger.Error("check duplicate markdown before upload failed", "title_id", titleID, "filename", header.Filename, "error", err)
				writeError(w, http.StatusInternalServerError, "check duplicate file failed")
				return
			}
		}
	}

	saved := make([]model.StudyFile, 0, len(files))
	invalidatedContentKeys := make([]string, 0, len(files))
	for _, header := range files {
		file, overwritten, err := h.saveUploadedFile(r.Context(), titleID, header, overwrite)
		if err != nil {
			h.logger.Error("save uploaded markdown failed", "title_id", titleID, "filename", header.Filename, "error", err)
			if errors.Is(err, errInvalidMarkdownFile) {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			if errors.Is(err, errDuplicateMarkdownFile) {
				writeError(w, http.StatusConflict, err.Error())
				return
			}
			writeError(w, http.StatusInternalServerError, "upload file failed")
			return
		}
		if overwritten {
			invalidatedContentKeys = append(invalidatedContentKeys, fmt.Sprintf("study:files:%s:content", file.ID))
		}
		saved = append(saved, file)
	}

	cacheKeys := append([]string{fmt.Sprintf("study:titles:%s:files", titleID), "study:titles"}, invalidatedContentKeys...)
	if err := h.cache.Delete(r.Context(), cacheKeys...); err != nil {
		h.logger.Warn("invalidate files cache after upload failed", "title_id", titleID, "error", err)
	}

	writeJSON(w, http.StatusCreated, saved)
}

func (h *Handler) saveUploadedFile(ctx context.Context, titleID string, header *multipart.FileHeader, overwrite bool) (model.StudyFile, bool, error) {
	if !strings.EqualFold(filepath.Ext(header.Filename), ".md") && !strings.EqualFold(filepath.Ext(header.Filename), ".markdown") {
		return model.StudyFile{}, false, fmt.Errorf("%w: %s", errInvalidMarkdownFile, header.Filename)
	}

	existing, err := h.store.GetFileByTitleAndFilename(ctx, titleID, header.Filename)
	if err != nil && !errors.Is(err, model.ErrNotFound) {
		return model.StudyFile{}, false, err
	}
	overwriting := !errors.Is(err, model.ErrNotFound)
	if overwriting && !overwrite {
		return model.StudyFile{}, false, fmt.Errorf("%w: %s", errDuplicateMarkdownFile, header.Filename)
	}

	src, err := header.Open()
	if err != nil {
		return model.StudyFile{}, false, fmt.Errorf("open multipart file: %w", err)
	}
	defer src.Close()

	fileID := newID("file")
	if overwriting {
		fileID = existing.ID
	}
	ossKey, err := h.objects.PutMarkdown(ctx, titleID, fileID, header.Filename, src)
	if err != nil {
		return model.StudyFile{}, false, err
	}

	file := model.StudyFile{
		ID:          fileID,
		TitleID:     titleID,
		Filename:    header.Filename,
		OSSKey:      ossKey,
		Size:        header.Size,
		ContentType: "text/markdown; charset=utf-8",
	}
	if overwriting {
		saved, err := h.store.UpdateFile(ctx, file)
		return saved, true, err
	}
	saved, err := h.store.AddFile(ctx, file)
	return saved, false, err
}

func (h *Handler) getFileContent(w http.ResponseWriter, r *http.Request, path string) {
	fileID := strings.TrimSuffix(strings.TrimPrefix(path, "/study/files/"), "/content")
	file, err := h.store.GetFile(r.Context(), fileID)
	if errors.Is(err, model.ErrNotFound) {
		writeError(w, http.StatusNotFound, "file not found")
		return
	}
	if err != nil {
		h.logger.Error("get file failed before content fetch", "file_id", fileID, "error", err)
		writeError(w, http.StatusInternalServerError, "get file failed")
		return
	}

	cacheKey := fmt.Sprintf("study:files:%s:content", fileID)
	var content string
	if err := h.cache.Get(r.Context(), cacheKey, &content); err == nil {
		w.Header().Set("Content-Type", file.ContentType)
		if _, err := w.Write([]byte(content)); err != nil {
			h.logger.Error("write cached markdown content failed", "file_id", fileID, "error", err)
		}
		return
	}

	rc, err := h.objects.GetMarkdown(r.Context(), file.OSSKey)
	if err != nil {
		h.logger.Error("fetch markdown content failed", "file_id", fileID, "oss_key", file.OSSKey, "error", err)
		writeError(w, http.StatusInternalServerError, "fetch content failed")
		return
	}
	defer rc.Close()

	data, err := io.ReadAll(rc)
	if err != nil {
		h.logger.Error("read markdown content failed", "file_id", fileID, "error", err)
		writeError(w, http.StatusInternalServerError, "read content failed")
		return
	}

	content = string(data)
	if err := h.cache.Set(r.Context(), cacheKey, content, 0); err != nil {
		h.logger.Warn("cache markdown content failed", "file_id", fileID, "error", err)
	}

	w.Header().Set("Content-Type", file.ContentType)
	if _, err := w.Write(data); err != nil {
		h.logger.Error("write markdown content failed", "file_id", fileID, "error", err)
	}
}

func (h *Handler) deleteFile(w http.ResponseWriter, r *http.Request, fileID string) {
	file, err := h.store.GetFile(r.Context(), fileID)
	if errors.Is(err, model.ErrNotFound) {
		writeError(w, http.StatusNotFound, "file not found")
		return
	}
	if err != nil {
		h.logger.Error("get file before delete failed", "file_id", fileID, "error", err)
		writeError(w, http.StatusInternalServerError, "get file failed")
		return
	}

	if err := h.store.DeleteFile(r.Context(), fileID); errors.Is(err, model.ErrNotFound) {
		writeError(w, http.StatusNotFound, "file not found")
		return
	} else if err != nil {
		h.logger.Error("delete file failed", "file_id", fileID, "error", err)
		writeError(w, http.StatusInternalServerError, "delete file failed")
		return
	}

	if err := h.cache.Delete(
		r.Context(),
		fmt.Sprintf("study:titles:%s:files", file.TitleID),
		fmt.Sprintf("study:files:%s:content", file.ID),
		"study:titles",
		fmt.Sprintf("study:titles:%s", file.TitleID),
	); err != nil {
		h.logger.Warn("invalidate cache after file delete failed", "file_id", fileID, "error", err)
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "file deleted"})
}

func (h *Handler) listFiles(w http.ResponseWriter, r *http.Request, path string) {
	titleID := strings.TrimSuffix(strings.TrimPrefix(path, "/study/titles/"), "/files")

	var files []model.StudyFile
	key := fmt.Sprintf("study:titles:%s:files", titleID)
	if err := h.cache.Get(r.Context(), key, &files); err == nil {
		writeJSON(w, http.StatusOK, files)
		return
	}

	exists, err := h.store.TitleExists(r.Context(), titleID)
	if err != nil {
		h.logger.Error("check title before list files failed", "title_id", titleID, "error", err)
		writeError(w, http.StatusInternalServerError, "check title failed")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "title not found")
		return
	}
	files, err = h.store.ListFiles(r.Context(), titleID)
	if err != nil {
		h.logger.Error("list files failed", "title_id", titleID, "error", err)
		writeError(w, http.StatusInternalServerError, "list files failed")
		return
	}

	if err := h.cache.Set(r.Context(), key, files, 1*time.Hour); err != nil {
		h.logger.Warn("cache files failed", "title_id", titleID, "error", err)
	}
	writeJSON(w, http.StatusOK, files)
}

func (h *Handler) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (h *Handler) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		h.logger.Info("request handled", "method", r.Method, "path", r.URL.Path, "duration_ms", time.Since(start).Milliseconds())
	})
}

func readJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("invalid json: %w", err)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func contentDisposition(filename string) string {
	return fmt.Sprintf("attachment; filename=%q; filename*=UTF-8''%s", filename, url.PathEscape(filename))
}

func safeArchiveName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			return '_'
		}
		if r < 32 {
			return -1
		}
		return r
	}, name)
	name = strings.Trim(name, ". ")
	if name == "" {
		return "study-notes"
	}
	return name
}

func uniqueArchiveFilename(filename string, used map[string]int) string {
	name := safeArchiveName(path.Base(strings.TrimSpace(filename)))
	if filepath.Ext(name) == "" {
		name += ".md"
	}
	return uniqueArchiveName(name, used)
}

func uniqueArchiveName(name string, used map[string]int) string {
	count := used[name]
	used[name] = count + 1
	if count == 0 {
		return name
	}
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	return fmt.Sprintf("%s (%d)%s", base, count+1, ext)
}

func newID(prefix string) string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("generate random id: %v", err))
	}
	return prefix + "_" + hex.EncodeToString(buf)
}
