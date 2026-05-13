package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"studyplan/backend/internal/cache"
	"studyplan/backend/internal/config"
	"studyplan/backend/internal/db"
	"studyplan/backend/internal/handler"
	"studyplan/backend/internal/storage"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("configuration failed", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL, logger)
	if err != nil {
		logger.Error("postgres connection failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	store := db.NewStore(pool, logger)
	if err := store.Migrate(ctx); err != nil {
		logger.Error("database migration failed", "error", err)
		os.Exit(1)
	}

	objects, err := storage.NewOSSStore(cfg.OSSEndpoint, cfg.OSSAccessKeyID, cfg.OSSAccessKeySecret, cfg.OSSBucket, cfg.OSSPrefix, logger)
	if err != nil {
		logger.Error("oss setup failed", "error", err)
		os.Exit(1)
	}

	redisCache, err := cache.NewRedisCache(cfg.RedisURL, cfg.RedisPassword)
	if err != nil {
		logger.Error("redis setup failed", "error", err)
		os.Exit(1)
	}

	server := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: handler.New(store, objects, redisCache, logger).Routes(),
	}

	go func() {
		logger.Info("study server starting", "addr", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	logger.Info("shutdown signal received")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("http server shutdown failed", "error", err)
		os.Exit(1)
	}
	logger.Info("study server stopped")
}
