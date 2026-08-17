package server

import (
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ipLimiter is a per-IP token bucket for the expensive routes.
type ipLimiter struct {
	mu    sync.Mutex
	seen  map[string]*visitor
	rps   rate.Limit
	burst int
}

type visitor struct {
	lim  *rate.Limiter
	last time.Time
}

// newIPLimiter builds a limiter for rps (Cfg.RateLimit, requests/sec per IP;
// 0 disables and returns nil). Burst is derived: 10x rps clamped to [10, 100].
func newIPLimiter(rps float64) *ipLimiter {
	if rps == 0 {
		return nil
	}
	burst := int(10 * rps)
	if burst < 10 {
		burst = 10
	}
	if burst > 100 {
		burst = 100
	}
	return &ipLimiter{seen: map[string]*visitor{}, rps: rate.Limit(rps), burst: burst}
}

func (l *ipLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	v, ok := l.seen[ip]
	if !ok {
		l.prune()
		v = &visitor{lim: rate.NewLimiter(l.rps, l.burst)}
		l.seen[ip] = v
	}
	v.last = time.Now()
	return v.lim.Allow()
}

// prune drops visitors idle >10m; called with mu held, on new-IP misses only.
func (l *ipLimiter) prune() {
	cutoff := time.Now().Add(-10 * time.Minute)
	for ip, v := range l.seen {
		if v.last.Before(cutoff) {
			delete(l.seen, ip)
		}
	}
}

// rateLimited marks the routes worth protecting: everything the token gate
// covers except /traces/ingest, which the preview hook posts in volume.
func rateLimited(r *http.Request) bool {
	if r.Method == http.MethodPost && r.URL.Path == "/traces/ingest" {
		return false
	}
	return requiresToken(r)
}

func withRateLimit(rps float64, next http.Handler) http.Handler {
	l := newIPLimiter(rps)
	if l == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rateLimited(r) {
			next.ServeHTTP(w, r)
			return
		}
		// RemoteAddr only: there is no proxy in this deployment shape, and
		// trusting X-Forwarded-For would hand every client a free bypass.
		ip, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			ip = r.RemoteAddr
		}
		if !l.allow(ip) {
			w.Header().Set("Retry-After", "1")
			httpError(w, http.StatusTooManyRequests, "too many requests from this address; slow down")
			return
		}
		next.ServeHTTP(w, r)
	})
}
