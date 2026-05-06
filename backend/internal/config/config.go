package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port               string
	DatabaseURL        string
	OSSAccessKeyID     string
	OSSAccessKeySecret string
	OSSEndpoint        string
	OSSBucket          string
	OSSPrefix          string
	ShutdownTimeout    time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Port:            getEnv("PORT", "8080"),
		OSSPrefix:       strings.Trim(getEnv("OSS_PREFIX", "study"), "/"),
		ShutdownTimeout: getDurationEnv("SHUTDOWN_TIMEOUT_SECONDS", 10) * time.Second,
	}

	cfg.DatabaseURL = os.Getenv("DATABASE_URL")
	cfg.OSSAccessKeyID = os.Getenv("ALIYUN_OSS_ACCESS_KEY_ID")
	cfg.OSSAccessKeySecret = os.Getenv("ALIYUN_OSS_ACCESS_KEY_SECRET")
	cfg.OSSEndpoint = os.Getenv("ALIYUN_OSS_ENDPOINT")
	cfg.OSSBucket = os.Getenv("ALIYUN_OSS_BUCKET")

	missing := make([]string, 0)
	for key, value := range map[string]string{
		"DATABASE_URL":                 cfg.DatabaseURL,
		"ALIYUN_OSS_ACCESS_KEY_ID":     cfg.OSSAccessKeyID,
		"ALIYUN_OSS_ACCESS_KEY_SECRET": cfg.OSSAccessKeySecret,
		"ALIYUN_OSS_ENDPOINT":          cfg.OSSEndpoint,
		"ALIYUN_OSS_BUCKET":            cfg.OSSBucket,
	} {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getDurationEnv(key string, fallback int) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return time.Duration(fallback)
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return time.Duration(fallback)
	}
	return time.Duration(parsed)
}
