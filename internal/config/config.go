// Package config parses every TERRA_* environment variable once at startup.
// Bad values fall back to the default silently, matching the old per-call-site
// behaviour.
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr  string // TERRA_ADDR (serve overrides with --addr)
	Token string // TERRA_TOKEN; empty leaves the API open

	RateLimit          float64       // TERRA_RATE_LIMIT req/s per IP; 0 disables
	AnalyzeConcurrency int           // TERRA_ANALYZE_CONCURRENCY
	AnalyzeTimeout     time.Duration // TERRA_ANALYZE_TIMEOUT

	AnalyzerURL string // TERRA_ANALYZER_URL, no trailing slash
	WebURL      string // TERRA_WEB_URL
	PublicURL   string // TERRA_PUBLIC_URL, no trailing slash

	PreviewMode    string        // TERRA_PREVIEW_MODE, lowercased ("", "host", "docker")
	PreviewMax     int           // TERRA_PREVIEW_MAX; 0 rejects all docker previews
	PreviewTTL     time.Duration // TERRA_PREVIEW_TTL; <=0 disables expiry
	PreviewImage   string        // TERRA_PREVIEW_IMAGE
	PreviewNetwork string        // TERRA_PREVIEW_NETWORK
	DockerBin      string        // TERRA_DOCKER
	TraceHost      string        // TERRA_TRACE_HOST

	CheckoutDir     string // TERRA_CHECKOUT_DIR; empty uses the user cache dir
	CheckoutVolume  string // TERRA_CHECKOUT_VOLUME
	HostCheckoutDir string // TERRA_HOST_CHECKOUT_DIR
}

// FromEnv reads every TERRA_* variable and applies defaults.
func FromEnv() *Config {
	c := &Config{
		Addr:               os.Getenv("TERRA_ADDR"),
		Token:              strings.TrimSpace(os.Getenv("TERRA_TOKEN")),
		RateLimit:          2,
		AnalyzeConcurrency: 4,
		AnalyzeTimeout:     15 * time.Minute,
		AnalyzerURL:        "http://localhost:8010",
		WebURL:             strings.TrimSpace(os.Getenv("TERRA_WEB_URL")),
		PublicURL:          "http://127.0.0.1:8080",
		PreviewMode:        strings.ToLower(strings.TrimSpace(os.Getenv("TERRA_PREVIEW_MODE"))),
		PreviewMax:         2,
		PreviewTTL:         30 * time.Minute,
		PreviewImage:       "node:22-bookworm",
		PreviewNetwork:     strings.TrimSpace(os.Getenv("TERRA_PREVIEW_NETWORK")),
		DockerBin:          "docker",
		TraceHost:          "host.docker.internal",
		CheckoutDir:        strings.TrimSpace(os.Getenv("TERRA_CHECKOUT_DIR")),
		CheckoutVolume:     strings.TrimSpace(os.Getenv("TERRA_CHECKOUT_VOLUME")),
		HostCheckoutDir:    strings.TrimSpace(os.Getenv("TERRA_HOST_CHECKOUT_DIR")),
	}
	if raw := os.Getenv("TERRA_RATE_LIMIT"); raw != "" {
		if v, err := strconv.ParseFloat(raw, 64); err == nil && v >= 0 {
			c.RateLimit = v
		}
	}
	if n, err := strconv.Atoi(os.Getenv("TERRA_ANALYZE_CONCURRENCY")); err == nil && n >= 1 {
		c.AnalyzeConcurrency = n
	}
	if d, err := time.ParseDuration(os.Getenv("TERRA_ANALYZE_TIMEOUT")); err == nil && d > 0 {
		c.AnalyzeTimeout = d
	}
	if u := strings.TrimSuffix(os.Getenv("TERRA_ANALYZER_URL"), "/"); u != "" {
		c.AnalyzerURL = u
	}
	if u := strings.TrimSpace(os.Getenv("TERRA_PUBLIC_URL")); u != "" {
		c.PublicURL = strings.TrimRight(u, "/")
	}
	if v := strings.TrimSpace(os.Getenv("TERRA_PREVIEW_MAX")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			c.PreviewMax = n
		}
	}
	if v := strings.TrimSpace(os.Getenv("TERRA_PREVIEW_TTL")); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			c.PreviewTTL = d
		}
	}
	if img := strings.TrimSpace(os.Getenv("TERRA_PREVIEW_IMAGE")); img != "" {
		c.PreviewImage = img
	}
	if b := strings.TrimSpace(os.Getenv("TERRA_DOCKER")); b != "" {
		c.DockerBin = b
	}
	if h := strings.TrimSpace(os.Getenv("TERRA_TRACE_HOST")); h != "" {
		c.TraceHost = h
	}
	return c
}

// Port returns the listen port from Addr (default "8080"). The preview trace
// hook posts spans back to this port.
func (c *Config) Port() string {
	if c.Addr == "" {
		return "8080"
	}
	if i := strings.LastIndex(c.Addr, ":"); i >= 0 {
		return c.Addr[i+1:]
	}
	return c.Addr
}
