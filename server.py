import subprocess
from flask import Flask, request, Response, jsonify

app = Flask(__name__)

FORMAT_TO_MIME = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'html': 'text/html',
    'md': 'text/markdown'
}

@app.route('/api/convert', methods=['POST', 'OPTIONS'])
def convert():
    if request.method == 'OPTIONS':
        return ('', 204)
    data = request.get_json(force=True) or {}
    markdown = data.get('markdown')
    fmt = data.get('format')
    if not markdown or not fmt:
        return jsonify({'error': 'Missing markdown or format'}), 400
    args = ['pandoc', '--from=markdown', f'--to={fmt}', '--output=-']
    try:
        proc = subprocess.run(
            args,
            input=markdown.encode('utf-8'),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False
        )
    except FileNotFoundError:
        return jsonify({'error': 'Pandoc not installed'}), 500
    if proc.returncode != 0:
        return jsonify({'error': proc.stderr.decode('utf-8', errors='ignore')}), 500
    mime = FORMAT_TO_MIME.get(fmt, 'application/octet-stream')
    return Response(proc.stdout, mimetype=mime)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
