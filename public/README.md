# Public

Static files served directly by the web server.

## Files

| File | Purpose |
|------|---------|
| `robots.txt` | Search engine crawling rules |
| `privacy-policy.html` | Privacy policy page |
| `.well-known/` | Standard well-known URIs |

## Serving

Files are served from the root URL path:
- `/robots.txt` → `public/robots.txt`
- `/privacy-policy.html` → `public/privacy-policy.html`

## Notes

- Keep files minimal - most content served via React app
- Used for SEO and compliance requirements
