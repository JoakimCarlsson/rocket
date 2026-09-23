// Package rocket owns the rockets players publish to Explore and the likes
// on them. It is the only package that reads or writes the rockets and
// rocket_likes tables. A rocket's configuration is stored as the web app
// sent it: the web app is what knows its shape, and it validates every
// configuration it reads back.
package rocket
