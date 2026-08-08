// Demo auto sign-in for specific repos (today: usememos/memos). Opt-in per
// repo so the generic proxy layer stays repo-agnostic.
package preview

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	demoUser = "terra"
	demoPass = "terra-demo-2026"
)

// demoRepos lists normalized repo URLs with a demo-auth hook.
var demoRepos = map[string]bool{
	"https://github.com/usememos/memos": true,
}

// seedDemoAuth seeds a demo account for repos with a registered hook and
// returns a proxy Director hook that re-mints the refresh cookie on auth
// refresh requests (tokens rotate). Returns nil for repos without a hook,
// or when seeding failed.
func seedDemoAuth(repoKey, targetBase string) func(*http.Request) {
	if !demoRepos[repoKey] {
		return nil
	}
	base := strings.TrimRight(targetBase, "/")
	if !seedAuth(base) {
		return nil
	}
	client := &http.Client{Timeout: 5 * time.Second}
	return func(r *http.Request) {
		if (strings.Contains(r.URL.Path, "auth/refresh") ||
			strings.Contains(r.URL.Path, "AuthService/RefreshToken")) &&
			!strings.Contains(r.Header.Get("Cookie"), "memos_refresh=") {
			resp, err := signinDemo(client, base)
			if err != nil {
				return
			}
			if cookie := refreshCookie(resp); cookie != "" {
				if prev := r.Header.Get("Cookie"); prev != "" {
					r.Header.Set("Cookie", prev+"; "+cookie)
				} else {
					r.Header.Set("Cookie", cookie)
				}
			}
			resp.Body.Close()
		}
	}
}

func signinDemo(client *http.Client, base string) (*http.Response, error) {
	body := fmt.Sprintf(
		`{"passwordCredentials":{"username":%q,"password":%q}}`, demoUser, demoPass)
	return client.Post(base+"/api/v1/auth/signin", "application/json", strings.NewReader(body))
}

// refreshCookie reads memos_refresh from Set-Cookie or Grpc-Metadata-Set-Cookie.
func refreshCookie(resp *http.Response) string {
	for _, header := range []string{"Set-Cookie", "Grpc-Metadata-Set-Cookie"} {
		for _, value := range resp.Header.Values(header) {
			if strings.HasPrefix(value, "memos_refresh=") {
				return strings.SplitN(value, ";", 2)[0]
			}
		}
	}
	return ""
}

// seedAuth creates a demo user if needed and returns whether auth is available.
func seedAuth(base string) bool {
	client := &http.Client{Timeout: 5 * time.Second}

	resp, err := signinDemo(client, base)
	if err != nil {
		return false
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		userBody := fmt.Sprintf(
			`{"username":%q,"password":%q,"displayName":"Terra"}`, demoUser, demoPass)
		cr, err := client.Post(base+"/api/v1/users", "application/json", strings.NewReader(userBody))
		if err != nil {
			return false
		}
		created := cr.StatusCode == http.StatusOK
		cr.Body.Close()
		if resp, err = signinDemo(client, base); err != nil {
			return false
		}
		if created {
			seedMemos(client, base, resp)
		}
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK && refreshCookie(resp) != ""
}

// seedMemos posts a few public notes into a new demo instance.
func seedMemos(client *http.Client, base string, signinResp *http.Response) {
	var out struct {
		AccessToken string `json:"accessToken"`
	}
	raw, err := io.ReadAll(signinResp.Body)
	if err != nil || json.Unmarshal(raw, &out) != nil || out.AccessToken == "" {
		signinResp.Body = io.NopCloser(bytes.NewReader(raw))
		return
	}
	signinResp.Body = io.NopCloser(bytes.NewReader(raw))
	notes := []string{
		"**Welcome!** This is a live instance of `usememos/memos`, running inside Terra's map.",
		"Everything here is real — the screens come from `web/src`, requests go through `internal/api`, and notes land in `store/memo.go`.",
		"Try it: write a note, then ask Terra which file just saved it.",
	}
	for _, note := range notes {
		body, _ := json.Marshal(map[string]string{"content": note, "visibility": "PUBLIC"})
		req, _ := http.NewRequest("POST", base+"/api/v1/memos", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+out.AccessToken)
		if resp, err := client.Do(req); err == nil {
			resp.Body.Close()
		}
	}
}
