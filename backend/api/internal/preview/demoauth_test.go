package preview

import (
	"net/http"
	"testing"
)

func TestRefreshCookieAcceptsEitherHeader(t *testing.T) {
	resp := &http.Response{Header: http.Header{}}
	if refreshCookie(resp) != "" {
		t.Fatal("no headers: want empty")
	}
	resp.Header.Set("Grpc-Metadata-Set-Cookie", "memos_refresh=abc; Path=/; HttpOnly")
	if got := refreshCookie(resp); got != "memos_refresh=abc" {
		t.Fatalf("got %q", got)
	}
	resp.Header = http.Header{}
	resp.Header.Add("Set-Cookie", "other=1")
	resp.Header.Add("Set-Cookie", "memos_refresh=def")
	if got := refreshCookie(resp); got != "memos_refresh=def" {
		t.Fatalf("got %q", got)
	}
}
func TestSeedDemoAuthUnknownRepoIsNil(t *testing.T) {
	if seedDemoAuth("https://github.com/acme/notes", "http://localhost:1") != nil {
		t.Fatal("expected nil hook for repo without a demo-auth entry")
	}
}
