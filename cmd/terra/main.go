package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/Enizri/terra/internal/graph"
	"github.com/Enizri/terra/internal/preview"
	"github.com/Enizri/terra/internal/scan"
	"github.com/Enizri/terra/internal/server"
	"github.com/Enizri/terra/internal/store"
)

const usage = `usage:
  terra scan  <github-url> [-o out.json]
  terra map   <github-url> [-o map.json] [--db terra.db] [--model qwen2.5:3b]
  terra serve [--addr :8080] [--db terra.db]`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
	switch os.Args[1] {
	case "scan":
		runScan(os.Args[2:])
	case "map":
		runMap(os.Args[2:])
	case "serve":
		runServe(os.Args[2:])
	default:
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
}

func runScan(args []string) {
	fs := flag.NewFlagSet("scan", flag.ExitOnError)
	out := fs.String("o", "", "write JSON to file instead of stdout")
	url := parseArgs(fs, args)

	res, err := scan.Scan(url)
	if err != nil {
		fail(err)
	}
	write(*out, res)
	if *out != "" {
		fmt.Fprintf(os.Stderr, "wrote %s (%d files scanned)\n", *out, res.Stats.SourceFiles)
	}
}

func runMap(args []string) {
	fs := flag.NewFlagSet("map", flag.ExitOnError)
	out := fs.String("o", "", "write JSON to file instead of stdout")
	db := fs.String("db", "terra.db", "SQLite file to store the map in (empty to skip)")
	model := fs.String("model", "", "model for the analyzer to use (default: the analyzer's choice)")
	url := parseArgs(fs, args)

	res, err := scan.Scan(url)
	if err != nil {
		fail(err)
	}
	fmt.Fprintf(os.Stderr, "scanned %d source files, asking the analyzer for a map (this takes a minute)...\n", res.Stats.SourceFiles)

	m, warnings, err := graph.Analyze(res, *model)
	if err != nil {
		fail(err)
	}
	for _, w := range warnings {
		fmt.Fprintln(os.Stderr, "warning:", w)
	}

	write(*out, m)
	if *out != "" {
		fmt.Fprintf(os.Stderr, "wrote %s (%d components, %d relationships)\n", *out, len(m.Components), len(m.Relationships))
	}
	if *db != "" {
		if err := store.Save(*db, res, m); err != nil {
			fail(err)
		}
		fmt.Fprintf(os.Stderr, "stored %s in %s\n", res.RepositoryURL, *db)
	}
}

func runServe(args []string) {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fs.String("addr", ":8080", "address to listen on")
	db := fs.String("db", "terra.db", "SQLite file to store maps in")
	fs.Parse(args)

	// The trace hook inside previewed apps posts back to this server;
	// preview.terraPort reads TERRA_ADDR to build that URL. Without this a
	// non-default --addr silently loses all in-process spans.
	os.Setenv("TERRA_ADDR", *addr)

	// Preview dev servers are child process groups; reap them on Ctrl-C.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sig
		preview.StopAll()
		os.Exit(0)
	}()

	if err := (&server.Server{DB: *db}).ListenAndServe(*addr); err != nil {
		preview.StopAll()
		fail(err)
	}
}

// parseArgs accepts the URL before or after the flags and returns it.
func parseArgs(fs *flag.FlagSet, args []string) string {
	fs.Parse(args)
	if fs.NArg() > 1 {
		rest := fs.Args()
		fs.Parse(rest[1:])
		fs.Parse(rest[:1])
	}
	if fs.NArg() != 1 {
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
	return fs.Arg(0)
}

// write emits JSON to path, or to stdout when path is empty. Everything else
// the command says goes to stderr, so `terra map <url> | jq` works.
func write(path string, payload any) {
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		fail(err)
	}
	data = append(data, '\n')
	if path == "" {
		os.Stdout.Write(data)
		return
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "terra:", err)
	os.Exit(1)
}
