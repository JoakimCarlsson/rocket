// Package web embeds the Next.js static export so the server ships as one
// binary.
//
// A placeholder out/index.html is committed so the package always compiles;
// `npm run build` regenerates out/ with every page and the hashed assets under
// out/_next, which are what get embedded into a release build.
package web

import "embed"

// Dist holds the static export. Consumers should fs.Sub into "out".
//
//go:embed all:out
var Dist embed.FS
