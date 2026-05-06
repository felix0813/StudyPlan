package handler

import (
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
	UpdateTitle(context.Context, string, string) (model.Title, error)
	DeleteTitle(context.Context, string) error
	TitleExists(context.Context, string) (bool, error)
	AddFile(context.Context, model.StudyFile) (model.StudyFile, error)
	ListFiles(context.Context, string) ([]model.StudyFile, error)
}

type ObjectStore interface {
	Ping(context.Context) error
	PutMarkdown(context.Context, string, string, string, io.Reader) (string, error)
}

var errInvalidMarkdownFile = errors.New("only markdown files are allowed")

type Handler struct {
	store       Store
	objects     ObjectStore
	logger      *slog.Logger
	maxUpload   int64
	healthLimit time.Duration
}

func New(store Store, objects ObjectStore, logger *slog.Logger) *Handler {
	return &Handler{store: store, objects: objects, logger: logger, maxUpload: 32 << 20, healthLimit: 5 * time.Second}
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
	case r.Method == http.MethodPatch && strings.HasPrefix(path, "/study/titles/") && !strings.Contains(strings.TrimPrefix(path, "/study/titles/"), "/"):
		h.updateTitle(w, r, strings.TrimPrefix(path, "/study/titles/"))
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/study/titles/") && !strings.Contains(strings.TrimPrefix(path, "/study/titles/"), "/"):
		h.deleteTitle(w, r, strings.TrimPrefix(path, "/study/titles/"))
	case r.Method == http.MethodPost && strings.HasPrefix(path, "/study/titles/") && strings.HasSuffix(path, "/files"):
		h.uploadFiles(w, r, path)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/study/titles/") && strings.HasSuffix(path, "/files"):
		h.listFiles(w, r, path)
	default:
		writeError(w, http.StatusNotFound, "route not found")
	}
}

func (h *Handler) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), h.healthLimit)
	defer cancel()

	pgErr := h.store.Ping(ctx)
	ossErr := h.objects.Ping(ctx)
	status := http.StatusOK
	response := map[string]any{"status": "ok", "postgres": "ok", "oss": "ok"}
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
	writeJSON(w, http.StatusCreated, map[string]any{"message": "plan saved", "count": len(items)})
}

func (h *Handler) getPlan(w http.ResponseWriter, r *http.Request) {
	items, err := h.store.ListPlan(r.Context())
	if err != nil {
		h.logger.Error("list plan failed", "error", err)
		writeError(w, http.StatusInternalServerError, "list plan failed")
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) getPlanStatus(w http.ResponseWriter, r *http.Request) {
	summary, err := h.store.PlanSummary(r.Context())
	if err != nil {
		h.logger.Error("get plan status failed", "error", err)
		writeError(w, http.StatusInternalServerError, "get plan status failed")
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (h *Handler) getNextPlanItem(w http.ResponseWriter, r *http.Request) {
	item, err := h.store.NextPlanItem(r.Context())
	if err != nil {
		h.logger.Error("get next plan item failed", "error", err)
		writeError(w, http.StatusInternalServerError, "get next plan item failed")
		return
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
	writeJSON(w, http.StatusCreated, title)
}

func (h *Handler) listTitles(w http.ResponseWriter, r *http.Request) {
	titles, err := h.store.ListTitles(r.Context())
	if err != nil {
		h.logger.Error("list titles failed", "error", err)
		writeError(w, http.StatusInternalServerError, "list titles failed")
		return
	}
	writeJSON(w, http.StatusOK, titles)
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
	writeJSON(w, http.StatusOK, map[string]string{"message": "title deleted"})
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

	saved := make([]model.StudyFile, 0, len(files))
	for _, header := range files {
		file, err := h.saveUploadedFile(r.Context(), titleID, header)
		if err != nil {
			h.logger.Error("save uploaded markdown failed", "title_id", titleID, "filename", header.Filename, "error", err)
			if errors.Is(err, errInvalidMarkdownFile) {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeError(w, http.StatusInternalServerError, "upload file failed")
			return
		}
		saved = append(saved, file)
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (h *Handler) saveUploadedFile(ctx context.Context, titleID string, header *multipart.FileHeader) (model.StudyFile, error) {
	if !strings.EqualFold(filepath.Ext(header.Filename), ".md") && !strings.EqualFold(filepath.Ext(header.Filename), ".markdown") {
		return model.StudyFile{}, fmt.Errorf("%w: %s", errInvalidMarkdownFile, header.Filename)
	}
	src, err := header.Open()
	if err != nil {
		return model.StudyFile{}, fmt.Errorf("open multipart file: %w", err)
	}
	defer src.Close()

	fileID := newID("file")
	ossKey, err := h.objects.PutMarkdown(ctx, titleID, fileID, header.Filename, src)
	if err != nil {
		return model.StudyFile{}, err
	}
	return h.store.AddFile(ctx, model.StudyFile{
		ID:          fileID,
		TitleID:     titleID,
		Filename:    header.Filename,
		OSSKey:      ossKey,
		Size:        header.Size,
		ContentType: "text/markdown; charset=utf-8",
	})
}

func (h *Handler) listFiles(w http.ResponseWriter, r *http.Request, path string) {
	titleID := strings.TrimSuffix(strings.TrimPrefix(path, "/study/titles/"), "/files")
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
	files, err := h.store.ListFiles(r.Context(), titleID)
	if err != nil {
		h.logger.Error("list files failed", "title_id", titleID, "error", err)
		writeError(w, http.StatusInternalServerError, "list files failed")
		return
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

func newID(prefix string) string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("generate random id: %v", err))
	}
	return prefix + "_" + hex.EncodeToString(buf)
}
