#!/usr/bin/env python3
import requests
import base64
import json

# Create a minimal valid PNG image (1x1 pixel transparent PNG)
minimal_png = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82'
base64_image = base64.b64encode(minimal_png).decode('utf-8')

print('Testing OCR with valid image format...')
try:
    response = requests.post('https://relay-scan-app.preview.emergentagent.com/api/ocr', 
                            json={'image_base64': base64_image}, timeout=30)

    print(f'Status: {response.status_code}')
    print(f'Response: {json.dumps(response.json(), indent=2, ensure_ascii=False)}')
except Exception as e:
    print(f'Error: {e}')