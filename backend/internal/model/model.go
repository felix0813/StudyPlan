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
	Status   string `json:"status"`
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

func ValidStatus(status string) bool {
	return status == StatusIncomplete || status == StatusCompleted
}
