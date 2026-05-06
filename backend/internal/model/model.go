package model

import (
	"errors"
	"time"
)

var ErrNotFound = errors.New("not found")

const (
	StatusIncomplete = "incomplete"
	StatusCompleted  = "completed"
)

type PlanItem struct {
	ID       string `json:"id"`
	Position int    `json:"position"`
	Content  string `json:"content"`
	Status   bool   `json:"status"`
}

type PlanSummary struct {
	Total      int64 `json:"total"`
	Completed  int64 `json:"completed"`
	Incomplete int64 `json:"incomplete"`
}

type Title struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	UpdatedAt time.Time `json:"updated_at"`
	CreatedAt time.Time `json:"created_at"`
}

type StudyFile struct {
	ID          string    `json:"id"`
	TitleID     string    `json:"title_id"`
	Filename    string    `json:"filename"`
	OSSKey      string    `json:"oss_key"`
	Size        int64     `json:"size"`
	ContentType string    `json:"content_type"`
	CreatedAt   time.Time `json:"created_at"`
}

func StatusToStorage(status bool) string {
	if status {
		return StatusCompleted
	}
	return StatusIncomplete
}

func StatusFromStorage(status string) (bool, bool) {
	switch status {
	case StatusCompleted:
		return true, true
	case StatusIncomplete:
		return false, true
	default:
		return false, false
	}
}
