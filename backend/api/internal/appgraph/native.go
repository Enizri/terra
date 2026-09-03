package appgraph

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// lookPath is a seam so tests can pretend an SDK is (or is not) installed.
var lookPath = exec.LookPath

// platformDirs are the per-platform folders a Flutter, Expo or React Native
// project generates. They hold an Xcode project or a Gradle build that belongs
// to the app above them, not to an app of their own.
var platformDirs = map[string]bool{
	"ios": true, "android": true, "macos": true, "windows": true,
	"linux": true, "src-tauri": true,
}

// fromNative recognises toolchains with no package.json: Flutter, Xcode and
// Gradle. Only Flutter can be previewed, and only with the SDK installed.
func fromNative(root, dir string) []App {
	var apps []App
	if app, ok := flutterApp(root, dir); ok {
		apps = append(apps, app)
	}
	if glob(dir, "*.xcodeproj") || glob(dir, "*.xcworkspace") || exists(dir, "Package.swift") {
		apps = append(apps, App{
			Dir: rel(root, dir), Kind: KindMobile, Framework: "swift", Previewable: false,
			Reason: "This is an Xcode project. Previewing it needs Xcode and an iOS simulator, neither of which Terra can run.",
		})
	}
	if androidProject(dir) {
		apps = append(apps, App{
			Dir: rel(root, dir), Kind: KindMobile, Framework: "android", Previewable: false,
			Reason: "This is an Android project. Previewing it needs the Android SDK and an emulator, neither of which Terra can run.",
		})
	}
	return apps
}

func flutterApp(root, dir string) (App, bool) {
	data, err := os.ReadFile(filepath.Join(dir, "pubspec.yaml"))
	if err != nil || !strings.Contains(string(data), "flutter:") {
		return App{}, false
	}
	app := App{
		Dir: rel(root, dir), Kind: KindMobile, Framework: "flutter",
		Install: "flutter pub get", Run: "flutter run -d web-server --web-port {port}",
		Previewable: true,
	}
	if _, err := lookPath("flutter"); err != nil {
		app.Previewable = false
		app.Run = ""
		app.Reason = "The Flutter SDK is not installed on this machine, so Terra cannot build this app's web target."
	}
	return app, true
}

// androidProject wants Gradle *and* Android evidence: a plain JVM Gradle build
// is not a mobile app.
func androidProject(dir string) bool {
	for _, name := range []string{"build.gradle", "build.gradle.kts"} {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		if strings.Contains(string(data), "com.android") {
			return true
		}
	}
	return exists(dir, "src/main/AndroidManifest.xml") || exists(dir, "AndroidManifest.xml")
}

// dropNestedPlatformDirs removes the ios/, android/ and src-tauri/ children of
// an app that already owns them, so one Flutter or Expo app is not reported
// three times.
func dropNestedPlatformDirs(apps []App) []App {
	owners := map[string]bool{}
	for _, app := range apps {
		if app.Kind == KindMobile || app.Kind == KindDesktop {
			owners[app.Dir] = true
		}
	}
	kept := apps[:0]
	for _, app := range apps {
		if !platformDirs[filepath.Base(app.Dir)] || !ownedAbove(owners, app.Dir) {
			kept = append(kept, app)
		}
	}
	return kept
}

func ownedAbove(owners map[string]bool, dir string) bool {
	for parent := parentDir(dir); parent != ""; parent = parentDir(parent) {
		if owners[parent] {
			return true
		}
	}
	return false
}

func parentDir(dir string) string {
	if dir == "." || dir == "" {
		return ""
	}
	idx := strings.LastIndex(dir, "/")
	if idx < 0 {
		return "."
	}
	return dir[:idx]
}
