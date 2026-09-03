package appgraph

import (
	"sort"
	"strconv"
	"strings"
)

// kindRank decides which app a preview opens first: a web UI is what a
// visitor expects to see, an API is what it talks to.
var kindRank = map[Kind]int{KindWeb: 0, KindAPI: 1, KindDesktop: 2, KindMobile: 3}

// rank sorts apps primary-first: previewable ones, then by kind, then named
// frameworks over a bare script, then the shallower directory — so a
// monorepo's web/ app beats a root package.json that only has "start".
func rank(apps []App) {
	sort.SliceStable(apps, func(i, j int) bool {
		a, b := apps[i], apps[j]
		if a.Previewable != b.Previewable {
			return a.Previewable
		}
		if kindRank[a.Kind] != kindRank[b.Kind] {
			return kindRank[a.Kind] < kindRank[b.Kind]
		}
		if known(a) != known(b) {
			return known(a)
		}
		if da, db := dirDepth(a.Dir), dirDepth(b.Dir); da != db {
			return da < db
		}
		return a.Dir < b.Dir
	})
}

// known is false for the "some package.json with a dev script" fallback.
func known(app App) bool { return app.Framework != "node" }

func dirDepth(dir string) int {
	if dir == "." || dir == "" {
		return 0
	}
	return strings.Count(dir, "/") + 1
}

// assignIDs gives every app a stable, URL-safe id: apps mount at
// /__live/{id}/ once the runners boot more than one.
func assignIDs(apps []App) {
	taken := map[string]bool{}
	for i := range apps {
		id := slug(apps[i].Dir)
		if id == "" {
			id = string(apps[i].Kind)
		}
		if taken[id] {
			id += "-" + string(apps[i].Kind)
		}
		for n := 2; taken[id]; n++ {
			id = strings.TrimSuffix(id, "-"+strconv.Itoa(n-1)) + "-" + strconv.Itoa(n)
		}
		taken[id] = true
		apps[i].ID = id
	}
}

func slug(dir string) string {
	if dir == "." {
		return ""
	}
	var b strings.Builder
	for _, r := range strings.ToLower(dir) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

// link points every previewable app at the primary API, so the runners boot
// the API first and can hand the others its URL.
func link(apps []App) {
	api := ""
	for _, app := range apps {
		if app.Kind == KindAPI && app.Previewable {
			api = app.ID
			break
		}
	}
	if api == "" {
		return
	}
	for i := range apps {
		if apps[i].ID != api && apps[i].Previewable {
			apps[i].DependsOn = []string{api}
		}
	}
}
