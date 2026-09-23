package httpx

import (
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strings"

	"github.com/JoakimCarlsson/rocket/web"
)

// immutableCache is sent with Next's content-hashed build assets.
const immutableCache = "public, max-age=31536000, immutable"

// registerSPA serves the embedded static export at "/". More specific routes
// are matched first.
func (s *Server) registerSPA() {
	dist, err := fs.Sub(web.Dist, "out")
	if err != nil {
		panic(fmt.Sprintf("httpx: embedded web assets: %v", err))
	}
	s.router.HandleFunc(http.MethodGet, "/", spaHandler(dist))
}

// spaHandler serves the Next.js static export: a route resolves to its
// prerendered page (/explore to explore.html), a real file is served as-is,
// and anything else gets the export's 404 page. Backend prefixes get a plain
// 404 instead of a page.
func spaHandler(dist fs.FS) http.HandlerFunc {
	fileServer := http.FileServer(http.FS(dist))
	notFound, err := fs.ReadFile(dist, "404.html")
	if err != nil {
		notFound, err = fs.ReadFile(dist, "index.html")
	}
	if err != nil {
		panic(fmt.Sprintf("httpx: reading embedded pages: %v", err))
	}
	return func(w http.ResponseWriter, req *http.Request) {
		clean := strings.TrimPrefix(path.Clean(req.URL.Path), "/")
		if isBackendPath(clean) {
			http.NotFound(w, req)
			return
		}
		if target, ok := legacyShareRedirect(clean, req.URL.Query()); ok {
			http.Redirect(w, req, target, http.StatusMovedPermanently)
			return
		}
		if page := pageFor(clean); isFile(dist, page) {
			http.ServeFileFS(w, req, dist, page)
			return
		}
		if isFile(dist, clean) {
			if strings.HasPrefix(clean, "_next/static/") {
				w.Header().Set("Cache-Control", immutableCache)
			}
			fileServer.ServeHTTP(w, req)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write(notFound)
	}
}

// pageFor maps a cleaned route to the HTML file the export writes for it.
func pageFor(clean string) string {
	if clean == "" || clean == "." {
		return "index.html"
	}
	return clean + ".html"
}

// isFile reports whether name exists in dist and is not a directory.
func isFile(dist fs.FS, name string) bool {
	info, err := fs.Stat(dist, name)
	return err == nil && !info.IsDir()
}

// legacyShareRedirect maps a share link from before the static export,
// /r/{id}, to the page that now serves it, /r?id={id}, keeping ?card=1.
func legacyShareRedirect(clean string, query url.Values) (string, bool) {
	id, ok := strings.CutPrefix(clean, "r/")
	if !ok || id == "" || strings.Contains(id, "/") {
		return "", false
	}
	target := url.Values{"id": {id}}
	if query.Get("card") == "1" {
		target.Set("card", "1")
	}
	return "/r?" + target.Encode(), true
}

// isBackendPath reports whether a cleaned path belongs to the API surface, so
// a page is never returned for it.
func isBackendPath(clean string) bool {
	return clean == "api" || strings.HasPrefix(clean, "api/")
}
