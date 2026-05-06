package storage

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"path"
	"strings"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

type OSSStore struct {
	bucket *oss.Bucket
	prefix string
	logger *slog.Logger
}

func NewOSSStore(endpoint, accessKeyID, accessKeySecret, bucketName, prefix string, logger *slog.Logger) (*OSSStore, error) {
	client, err := oss.New(endpoint, accessKeyID, accessKeySecret)
	if err != nil {
		return nil, fmt.Errorf("create oss client: %w", err)
	}
	bucket, err := client.Bucket(bucketName)
	if err != nil {
		return nil, fmt.Errorf("open oss bucket: %w", err)
	}
	logger.Info("oss bucket configured", "bucket", bucketName, "prefix", prefix)
	return &OSSStore{bucket: bucket, prefix: strings.Trim(prefix, "/"), logger: logger}, nil
}

func (s *OSSStore) Ping(ctx context.Context) error {
	done := make(chan error, 1)
	go func() {
		_, err := s.bucket.ListObjects(oss.MaxKeys(1), oss.Prefix(s.prefix))
		done <- err
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-done:
		if err != nil {
			return fmt.Errorf("list oss bucket: %w", err)
		}
		return nil
	}
}

func (s *OSSStore) PutMarkdown(ctx context.Context, titleID, fileID, filename string, reader io.Reader) (string, error) {
	key := path.Join(s.prefix, "titles", titleID, fileID+"-"+sanitizeFilename(filename))
	done := make(chan error, 1)
	go func() {
		done <- s.bucket.PutObject(key, reader, oss.ContentType("text/markdown; charset=utf-8"))
	}()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case err := <-done:
		if err != nil {
			s.logger.Error("oss upload failed", "key", key, "error", err)
			return "", fmt.Errorf("put markdown object: %w", err)
		}
		s.logger.Info("markdown uploaded to oss", "key", key)
		return key, nil
	}
}

func sanitizeFilename(filename string) string {
	filename = path.Base(strings.TrimSpace(filename))
	if filename == "." || filename == "/" || filename == "" {
		return "record.md"
	}
	filename = strings.ReplaceAll(filename, " ", "_")
	return filename
}
