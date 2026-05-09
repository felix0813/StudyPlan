package db

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"studyplan/backend/internal/model"
)

type Store struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

func NewStore(pool *pgxpool.Pool, logger *slog.Logger) *Store {
	return &Store{pool: pool, logger: logger}
}

func Connect(ctx context.Context, databaseURL string, logger *slog.Logger) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create pg pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping pg: %w", err)
	}
	logger.Info("connected to postgres")
	return pool, nil
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) Migrate(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS plan_items (
			id TEXT PRIMARY KEY,
			position INTEGER NOT NULL UNIQUE,
			content TEXT NOT NULL,
			status TEXT NOT NULL CHECK (status IN ('incomplete', 'completed')),
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS titles (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS study_files (
			id TEXT PRIMARY KEY,
			title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
			filename TEXT NOT NULL,
			oss_key TEXT NOT NULL UNIQUE,
			size_bytes BIGINT NOT NULL,
			content_type TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		`CREATE INDEX IF NOT EXISTS study_files_title_id_created_at_idx ON study_files(title_id, created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.pool.Exec(ctx, statement); err != nil {
			s.logger.Error("database migration failed", "error", err)
			return fmt.Errorf("run migration: %w", err)
		}
	}
	s.logger.Info("database migrations completed")
	return nil
}

func (s *Store) ReplacePlan(ctx context.Context, items []model.PlanItem) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin replace plan transaction: %w", err)
	}
	defer rollback(ctx, tx, s.logger)

	if _, err := tx.Exec(ctx, `DELETE FROM plan_items`); err != nil {
		return fmt.Errorf("clear plan items: %w", err)
	}
	for idx, item := range items {
		id := newID("plan")
		_, err := tx.Exec(ctx, `INSERT INTO plan_items (id, position, content, status) VALUES ($1, $2, $3, $4)`, id, idx+1, item.Content, model.StatusToStorage(item.Status))
		if err != nil {
			return fmt.Errorf("insert plan item at position %d: %w", idx+1, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit replace plan transaction: %w", err)
	}
	s.logger.Info("study plan replaced", "items", len(items))
	return nil
}

func (s *Store) ListPlan(ctx context.Context) ([]model.PlanItem, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, position, content, status FROM plan_items ORDER BY position ASC`)
	if err != nil {
		return nil, fmt.Errorf("query plan: %w", err)
	}
	defer rows.Close()

	items := make([]model.PlanItem, 0)
	for rows.Next() {
		var item model.PlanItem
		var storedStatus string
		if err := rows.Scan(&item.ID, &item.Position, &item.Content, &storedStatus); err != nil {
			return nil, fmt.Errorf("scan plan item: %w", err)
		}
		parsedStatus, ok := model.StatusFromStorage(storedStatus)
		if !ok {
			s.logger.Error("invalid plan item status from database", "id", item.ID, "status", storedStatus)
			return nil, fmt.Errorf("invalid plan item status %q", storedStatus)
		}
		item.Status = parsedStatus
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) PlanSummary(ctx context.Context) (model.PlanSummary, error) {
	var summary model.PlanSummary
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'completed'), COUNT(*) FILTER (WHERE status = 'incomplete')
		FROM plan_items`).Scan(&summary.Total, &summary.Completed, &summary.Incomplete); err != nil {
		return model.PlanSummary{}, fmt.Errorf("query plan summary: %w", err)
	}
	return summary, nil
}

func (s *Store) NextPlanItem(ctx context.Context) (*model.PlanItem, error) {
	var item model.PlanItem
	var storedStatus string
	err := s.pool.QueryRow(ctx, `SELECT id, position, content, status FROM plan_items WHERE status = 'incomplete' ORDER BY position ASC LIMIT 1`).Scan(&item.ID, &item.Position, &item.Content, &storedStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query next plan item: %w", err)
	}
	parsedStatus, ok := model.StatusFromStorage(storedStatus)
	if !ok {
		s.logger.Error("invalid next plan item status from database", "id", item.ID, "status", storedStatus)
		return nil, fmt.Errorf("invalid next plan item status %q", storedStatus)
	}
	item.Status = parsedStatus
	return &item, nil
}

func (s *Store) UpdatePlanItemStatus(ctx context.Context, id string, status bool) (model.PlanItem, error) {
	var item model.PlanItem
	var storedStatus string
	newStatus := model.StatusToStorage(status)
	err := s.pool.QueryRow(ctx, `UPDATE plan_items SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, position, content, status`, id, newStatus).Scan(&item.ID, &item.Position, &item.Content, &storedStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.PlanItem{}, model.ErrNotFound
	}
	if err != nil {
		return model.PlanItem{}, fmt.Errorf("update plan item status: %w", err)
	}
	parsedStatus, ok := model.StatusFromStorage(storedStatus)
	if !ok {
		s.logger.Error("invalid updated plan item status from database", "id", item.ID, "status", storedStatus)
		return model.PlanItem{}, fmt.Errorf("invalid updated plan item status %q", storedStatus)
	}
	item.Status = parsedStatus
	s.logger.Info("plan item status updated", "id", id, "status", newStatus)
	return item, nil
}

func (s *Store) CreateTitle(ctx context.Context, name string) (model.Title, error) {
	id := newID("title")
	var title model.Title
	err := s.pool.QueryRow(ctx, `INSERT INTO titles (id, name) VALUES ($1, $2) RETURNING id, name, updated_at, created_at`, id, name).Scan(&title.ID, &title.Name, &title.UpdatedAt, &title.CreatedAt)
	if err != nil {
		return model.Title{}, fmt.Errorf("create title: %w", err)
	}
	s.logger.Info("title created", "id", id, "name", name)
	return title, nil
}

func (s *Store) GetTitle(ctx context.Context, id string) (model.Title, error) {
	var title model.Title
	err := s.pool.QueryRow(ctx, `SELECT id, name, updated_at, created_at FROM titles WHERE id = $1`, id).Scan(&title.ID, &title.Name, &title.UpdatedAt, &title.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Title{}, model.ErrNotFound
	}
	if err != nil {
		return model.Title{}, fmt.Errorf("get title: %w", err)
	}
	return title, nil
}

func (s *Store) ListTitles(ctx context.Context) ([]model.Title, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, updated_at, created_at FROM titles ORDER BY updated_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("query titles: %w", err)
	}
	defer rows.Close()
	titles := make([]model.Title, 0)
	for rows.Next() {
		var title model.Title
		if err := rows.Scan(&title.ID, &title.Name, &title.UpdatedAt, &title.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan title: %w", err)
		}
		titles = append(titles, title)
	}
	return titles, rows.Err()
}

func (s *Store) UpdateTitle(ctx context.Context, id, name string) (model.Title, error) {
	var title model.Title
	err := s.pool.QueryRow(ctx, `UPDATE titles SET name = $2, updated_at = now() WHERE id = $1 RETURNING id, name, updated_at, created_at`, id, name).Scan(&title.ID, &title.Name, &title.UpdatedAt, &title.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Title{}, model.ErrNotFound
	}
	if err != nil {
		return model.Title{}, fmt.Errorf("update title: %w", err)
	}
	s.logger.Info("title updated", "id", id, "name", name)
	return title, nil
}

func (s *Store) DeleteTitle(ctx context.Context, id string) error {
	commandTag, err := s.pool.Exec(ctx, `DELETE FROM titles WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete title: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return model.ErrNotFound
	}
	s.logger.Info("title deleted", "id", id)
	return nil
}

func (s *Store) TitleExists(ctx context.Context, id string) (bool, error) {
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM titles WHERE id = $1)`, id).Scan(&exists); err != nil {
		return false, fmt.Errorf("check title exists: %w", err)
	}
	return exists, nil
}

func (s *Store) GetFile(ctx context.Context, id string) (model.StudyFile, error) {
	var file model.StudyFile
	err := s.pool.QueryRow(ctx, `SELECT id, title_id, filename, oss_key, size_bytes, content_type, created_at FROM study_files WHERE id = $1`, id).Scan(&file.ID, &file.TitleID, &file.Filename, &file.OSSKey, &file.Size, &file.ContentType, &file.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.StudyFile{}, model.ErrNotFound
	}
	if err != nil {
		return model.StudyFile{}, fmt.Errorf("get study file: %w", err)
	}
	return file, nil
}

func (s *Store) AddFile(ctx context.Context, file model.StudyFile) (model.StudyFile, error) {
	if file.ID == "" {
		file.ID = newID("file")
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO study_files (id, title_id, filename, oss_key, size_bytes, content_type)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, title_id, filename, oss_key, size_bytes, content_type, created_at`,
		file.ID, file.TitleID, file.Filename, file.OSSKey, file.Size, file.ContentType,
	).Scan(&file.ID, &file.TitleID, &file.Filename, &file.OSSKey, &file.Size, &file.ContentType, &file.CreatedAt)
	if err != nil {
		return model.StudyFile{}, fmt.Errorf("insert study file: %w", err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE titles SET updated_at = now() WHERE id = $1`, file.TitleID); err != nil {
		return model.StudyFile{}, fmt.Errorf("touch title updated_at: %w", err)
	}
	s.logger.Info("study file metadata saved", "id", file.ID, "title_id", file.TitleID, "oss_key", file.OSSKey)
	return file, nil
}

func (s *Store) ListFiles(ctx context.Context, titleID string) ([]model.StudyFile, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, title_id, filename, oss_key, size_bytes, content_type, created_at FROM study_files WHERE title_id = $1 ORDER BY created_at DESC`, titleID)
	if err != nil {
		return nil, fmt.Errorf("query study files: %w", err)
	}
	defer rows.Close()
	files := make([]model.StudyFile, 0)
	for rows.Next() {
		var file model.StudyFile
		if err := rows.Scan(&file.ID, &file.TitleID, &file.Filename, &file.OSSKey, &file.Size, &file.ContentType, &file.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan study file: %w", err)
		}
		files = append(files, file)
	}
	return files, rows.Err()
}

func rollback(ctx context.Context, tx pgx.Tx, logger *slog.Logger) {
	if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
		logger.Warn("transaction rollback failed", "error", err)
	}
}

func newID(prefix string) string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("generate random id: %v", err))
	}
	return strings.Join([]string{prefix, hex.EncodeToString(buf)}, "_")
}
