package preview

import (
	"bytes"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
)

// serveProxy reverse-proxies a localhost/dev target on an ephemeral loopback
// port. The caller owns the returned listener and must close it to stop.
func serveProxy(repoKey, targetBase string, authFix func(*http.Request)) (string, net.Listener, error) {
	handler, err := newInjectProxy(repoKey, targetBase, authFix, "", false)
	if err != nil {
		return "", nil, err
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", nil, err
	}
	go http.Serve(ln, handler)
	return "http://" + ln.Addr().String() + "/", ln, nil
}

// newInjectProxy reverse-proxies targetBase, injects select.js, and emits spans.
// authFix, when non-nil, is a per-repo hook that may rewrite outgoing request
// auth headers (see seedDemoAuth). publicPrefix is empty for the host loopback
// proxy, or "/__live/{id}" for the path proxy (Vite --base matches; full paths
// are forwarded, not stripped). stripPrefix rewrites /__live/{id}/... to /...
// for frameworks that cannot be told a base path.
func newInjectProxy(repoKey, targetBase string, authFix func(*http.Request), publicPrefix string, stripPrefix bool) (http.Handler, error) {
	base := strings.TrimRight(targetBase, "/")
	target, err := url.Parse(base)
	if err != nil || target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("invalid preview target %q", targetBase)
	}
	inject := `<script src="` + publicPrefix + `/__terra/select.js"></script>`
	rp := httputil.NewSingleHostReverseProxy(target)
	director := rp.Director
	rp.Director = func(r *http.Request) {
		director(r)
		if stripPrefix && publicPrefix != "" {
			path := r.URL.Path
			switch {
			case path == publicPrefix:
				r.URL.Path = "/"
			case strings.HasPrefix(path, publicPrefix+"/"):
				r.URL.Path = path[len(publicPrefix):]
			}
		}
		// Vite 6+ rejects unknown Host values (container DNS names). localhost
		// is always allowed; the URL still targets the sibling container.
		r.Host = "localhost"
		r.Header.Del("Accept-Encoding")
		if authFix != nil {
			authFix(r)
		}
	}
	rp.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Del("X-Frame-Options")
		resp.Header.Del("Content-Security-Policy")
		if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") {
			return nil
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return err
		}
		tag := []byte(inject)
		if i := bytes.Index(body, []byte("</head>")); i >= 0 {
			body = append(body[:i:i], append(tag, body[i:]...)...)
		} else {
			body = append(body, tag...)
		}
		resp.Body = io.NopCloser(bytes.NewReader(body))
		resp.ContentLength = int64(len(body))
		resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
		return nil
	}

	serveSelect := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(loadSelectJS())
	}
	mux := http.NewServeMux()
	if publicPrefix == "" {
		mux.HandleFunc("/__terra/select.js", serveSelect)
		mux.Handle("/", rp)
	} else {
		mux.HandleFunc(publicPrefix+"/__terra/select.js", serveSelect)
		mux.Handle(publicPrefix+"/", rp)
		mux.Handle(publicPrefix, rp)
	}
	return traceMiddleware(repoKey, publicPrefix, mux), nil
}
