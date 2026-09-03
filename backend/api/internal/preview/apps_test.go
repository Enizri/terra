package preview

import (
	"net"
	"testing"

	"github.com/Enizri/terra/backend/api/internal/appgraph"
)

func TestBootOrderAPIsBeforeDependents(t *testing.T) {
	apps := []appgraph.App{
		{ID: "web", Kind: appgraph.KindWeb, Previewable: true, DependsOn: []string{"api"}},
		{ID: "api", Kind: appgraph.KindAPI, Previewable: true},
		{ID: "mobile", Kind: appgraph.KindMobile, Previewable: false, Reason: "needs a simulator"},
	}
	got := bootOrder(apps)
	if len(got) != 2 || got[0].ID != "api" || got[1].ID != "web" {
		t.Fatalf("bootOrder = %v, want [api web]", ids(got))
	}
}

func TestAPIProxyEnvCoversEveryFramework(t *testing.T) {
	got := apiProxyEnv("http://localhost:8081")
	want := []string{
		"DEV_PROXY_SERVER=http://localhost:8081",
		"API_URL=http://localhost:8081",
		"VITE_API_URL=http://localhost:8081",
		"NEXT_PUBLIC_API_URL=http://localhost:8081",
	}
	if len(got) != len(want) {
		t.Fatalf("apiProxyEnv = %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("apiProxyEnv[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestPerAppPortAllocation(t *testing.T) {
	apps := bootOrder([]appgraph.App{
		{ID: "api", Kind: appgraph.KindAPI, Previewable: true},
		{ID: "web", Kind: appgraph.KindWeb, Previewable: true, DependsOn: []string{"api"}},
	})
	seen := map[int]string{}
	var lns []net.Listener
	t.Cleanup(func() {
		for _, ln := range lns {
			ln.Close()
		}
	})
	for _, app := range apps {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		lns = append(lns, ln)
		port := ln.Addr().(*net.TCPAddr).Port
		if other, ok := seen[port]; ok {
			t.Fatalf("port %d assigned to %s and %s", port, other, app.ID)
		}
		seen[port] = app.ID
	}
	if len(seen) != 2 {
		t.Fatalf("got %d unique ports, want 2", len(seen))
	}
}

func TestAppLiveIDStableAndUnique(t *testing.T) {
	key := "https://github.com/acme/notes"
	primary := appLiveID(key, "web", true)
	again := appLiveID(key, "web", true)
	if primary == "" || primary != again {
		t.Fatalf("primary live id not stable: %q vs %q", primary, again)
	}
	api := appLiveID(key, "api", false)
	if api == primary {
		t.Fatal("secondary live id must not collide with the primary mount")
	}
}

func TestDockerableIsNodeNotGo(t *testing.T) {
	if !dockerable(appgraph.App{Run: "npm run dev", Framework: "vite"}) {
		t.Fatal("vite should run in the node sibling")
	}
	if dockerable(appgraph.App{Run: "go run ./cmd/api", Framework: "go"}) {
		t.Fatal("go should stay on the host, the node image has no toolchain")
	}
	if dockerable(appgraph.App{Run: "uvicorn main:app --port {port}", Framework: "fastapi"}) {
		t.Fatal("python should stay on the host")
	}
}

func ids(apps []appgraph.App) []string {
	out := make([]string, len(apps))
	for i, app := range apps {
		out[i] = app.ID
	}
	return out
}
