package trace

import "testing"

func TestWorthKeeping(t *testing.T) {
	cases := map[string]bool{
		"/":                                    true,
		"/api/v1/memos":                        true,
		"/memos.api.v1.MemoService/CreateMemo": true, // RPC dots are not extensions
		"/auth":                                true,
		"/src/main.tsx":                        false,
		"/@vite/client":                        false,
		"/assets/logo.svg":                     false,
		"/node_modules/.vite/deps/react.js":    false,
		"/__terra/select.js":                   false,
		"/main.abc123.hot-update.json":         false,
		"/bundle.JS":                           false, // extension check is case-insensitive
		"/index.html":                          false,
	}
	for urlPath, want := range cases {
		if got := WorthKeeping(urlPath); got != want {
			t.Errorf("WorthKeeping(%q) = %v, want %v", urlPath, got, want)
		}
	}
}
