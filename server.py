"""Tiny Flask wrapper around Pandoc for converting Markdown files."""

# Standard library
import subprocess

# Third party
from flask import Flask, request, Response, jsonify

# Create the Flask application instance
app = Flask(__name__)

# Map requested output formats to the appropriate MIME type so the browser
# knows what kind of file is being returned.
FORMAT_TO_MIME = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'html': 'text/html',
    'md': 'text/markdown'
}

@app.route('/api/convert', methods=['POST', 'OPTIONS'])
def convert():
    """Convert Markdown into another document format using Pandoc."""
    # Handle CORS preflight requests with an empty 204 response
    if request.method == 'OPTIONS':
        return ('', 204)

    # Parse incoming JSON and pull out the markdown text and desired format
    data = request.get_json(force=True) or {}
    markdown = data.get('markdown')
    fmt = data.get('format')

    # Both fields are required, otherwise the client made a bad request
    if not markdown or not fmt:
        return jsonify({'error': 'Missing markdown or format'}), 400

    # Build the pandoc command that reads from STDIN and writes the result to STDOUT
    args = ['pandoc', '--from=markdown', f'--to={fmt}', '--output=-']

    try:
        # Run pandoc and capture its output without raising on non‑zero exit codes
        proc = subprocess.run(
            args,
            input=markdown.encode('utf-8'),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False
        )
    except FileNotFoundError:
        # pandoc binary is missing from the system
        return jsonify({'error': 'Pandoc not installed'}), 500

    if proc.returncode != 0:
        # Propagate pandoc errors back to the client
        return jsonify({'error': proc.stderr.decode('utf-8', errors='ignore')}), 500

    # Determine the proper MIME type to use for the response body
    mime = FORMAT_TO_MIME.get(fmt, 'application/octet-stream')
    return Response(proc.stdout, mimetype=mime)

if __name__ == '__main__':
    # Expose the service to the host machine on port 8000
    app.run(host='0.0.0.0', port=8000)
