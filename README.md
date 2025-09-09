# Scriptor

## Exporting documents

Scriptor now supports exporting documents in multiple formats. The export menu in the toolbar allows choosing **Markdown**, **PDF**, **DOCX**, or **HTML**.

- Markdown is generated directly in the browser.
- PDF, DOCX, and HTML rely on [Pandoc](https://pandoc.org/) for conversion. The frontend expects a backend endpoint at `/api/convert` that accepts JSON `{ markdown, format }` and returns the converted file as a binary response. Alternatively, a Pandoc WASM bundle can be used to provide the same API.

Ensure that Pandoc is available on the server and that the `/api/convert` endpoint is implemented before enabling non-Markdown exports.

## Deployment

Serve `index.html` and the `assets/` directory as static files. Run the conversion server alongside the frontend so that `/api/convert` is reachable.

```
pip install flask  # only required for the Python server
python server.py
```

The server accepts `POST /api/convert` with JSON `{ markdown, format }` and streams the converted file back using Pandoc. The frontend checks this endpoint at startup and only enables PDF, DOCX, and HTML exports when it responds.

## Outline numbering

Lines that begin with a dotted number sequence such as `1.2.3 ` are treated as an outline. Press **Enter** to insert a new line with the last segment incremented. Use **Tab** to deepen the outline (appending `.1`) and **Shift+Tab** to move back up a level. The caret remains after the inserted prefix so you can continue typing immediately.

## Diff styling

When comparing versions, deletions are wrapped with the `.diff-del` class and insertions with `.diff-add`.
