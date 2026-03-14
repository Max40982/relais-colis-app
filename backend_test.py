#!/usr/bin/env python3
"""
Backend API Testing Script for Relais Colis App
Tests the three main endpoints: /api/scan, /api/ocr, and /api/packages
"""

import requests
import json
import sys
from typing import Dict, Any
import base64
import time

# Backend URL from frontend env
BACKEND_URL = "https://relay-scan-app.preview.emergentagent.com"
API_BASE = f"{BACKEND_URL}/api"

def test_endpoint(method: str, endpoint: str, data: Dict[Any, Any] = None) -> Dict[str, Any]:
    """Test an API endpoint and return results"""
    url = f"{API_BASE}{endpoint}"
    
    try:
        if method == "GET":
            response = requests.get(url, timeout=30)
        elif method == "POST":
            response = requests.post(url, json=data, timeout=30)
        else:
            return {"success": False, "error": f"Unsupported method: {method}"}
        
        # Try to parse JSON response
        try:
            response_data = response.json()
        except ValueError:
            response_data = {"raw_response": response.text}
        
        return {
            "success": response.status_code < 400,
            "status_code": response.status_code,
            "data": response_data,
            "error": None if response.status_code < 400 else f"HTTP {response.status_code}"
        }
    
    except requests.exceptions.RequestException as e:
        return {
            "success": False,
            "status_code": None,
            "data": None,
            "error": str(e)
        }

def test_scan_endpoint():
    """Test POST /api/scan endpoint"""
    print("\n=== Testing POST /api/scan ===")
    
    # Test with a realistic French name
    test_data = {"name": "Dupont Marie"}
    
    result = test_endpoint("POST", "/scan", test_data)
    
    print(f"Status Code: {result['status_code']}")
    print(f"Success: {result['success']}")
    
    if result['success']:
        data = result['data']
        print(f"Response: {json.dumps(data, indent=2, ensure_ascii=False)}")
        
        # Validate expected fields
        expected_fields = ['success', 'name', 'is_new', 'package_count', 'numero']
        missing_fields = [field for field in expected_fields if field not in data]
        
        if missing_fields:
            print(f"⚠️  Missing expected fields: {missing_fields}")
            return False
        
        print(f"✅ Name: {data['name']}")
        print(f"✅ Is New: {data['is_new']}")
        print(f"✅ Package Count: {data['package_count']}")
        print(f"✅ Numero: {data['numero']}")
        
        return True
    else:
        print(f"❌ Error: {result['error']}")
        if result['data']:
            print(f"Response: {json.dumps(result['data'], indent=2, ensure_ascii=False)}")
        return False

def test_ocr_endpoint():
    """Test POST /api/ocr endpoint"""
    print("\n=== Testing POST /api/ocr ===")
    
    # Test with fake base64 (should handle gracefully)
    test_data = {"image_base64": "test"}
    
    result = test_endpoint("POST", "/ocr", test_data)
    
    print(f"Status Code: {result['status_code']}")
    print(f"Success: {result['success']}")
    
    if result['status_code'] == 200:  # Even if OCR fails, should return 200 with error message
        data = result['data']
        print(f"Response: {json.dumps(data, indent=2, ensure_ascii=False)}")
        
        # Validate expected fields for OCR response
        expected_fields = ['success', 'message']
        missing_fields = [field for field in expected_fields if field not in data]
        
        if missing_fields:
            print(f"⚠️  Missing expected fields: {missing_fields}")
            return False
        
        # OCR should gracefully handle invalid input
        if not data.get('success'):
            print(f"✅ OCR correctly handled invalid input: {data['message']}")
        else:
            print(f"✅ OCR success: {data.get('name', 'N/A')}")
        
        return True
    else:
        print(f"❌ Error: {result['error']}")
        if result['data']:
            print(f"Response: {json.dumps(result['data'], indent=2, ensure_ascii=False)}")
        return False

def test_packages_endpoint():
    """Test GET /api/packages endpoint"""
    print("\n=== Testing GET /api/packages ===")
    
    result = test_endpoint("GET", "/packages")
    
    print(f"Status Code: {result['status_code']}")
    print(f"Success: {result['success']}")
    
    if result['success']:
        data = result['data']
        print(f"Number of packages: {len(data)}")
        
        if data:
            print(f"Sample package: {json.dumps(data[0], indent=2, ensure_ascii=False)}")
            
            # Validate expected fields for package records
            expected_fields = ['id', 'name', 'numero', 'statuts']
            sample_package = data[0]
            missing_fields = [field for field in expected_fields if field not in sample_package]
            
            if missing_fields:
                print(f"⚠️  Missing expected fields in package record: {missing_fields}")
                return False
        else:
            print("✅ No packages found (empty list is valid)")
        
        print(f"✅ Packages endpoint working correctly")
        return True
    else:
        print(f"❌ Error: {result['error']}")
        if result['data']:
            print(f"Response: {json.dumps(result['data'], indent=2, ensure_ascii=False)}")
        return False

def test_health_endpoint():
    """Test GET /api/health endpoint for basic connectivity"""
    print("\n=== Testing GET /api/health ===")
    
    result = test_endpoint("GET", "/health")
    
    print(f"Status Code: {result['status_code']}")
    print(f"Success: {result['success']}")
    
    if result['success']:
        data = result['data']
        print(f"Health status: {json.dumps(data, indent=2, ensure_ascii=False)}")
        
        if data.get('status') == 'ok':
            print("✅ Backend is healthy")
            if data.get('airtable_configured'):
                print("✅ Airtable is configured")
            else:
                print("⚠️  Airtable may not be configured")
        return True
    else:
        print(f"❌ Health check failed: {result['error']}")
        return False

def main():
    """Run all backend tests"""
    print(f"🧪 Testing Relais Colis Backend API")
    print(f"Backend URL: {BACKEND_URL}")
    print("=" * 50)
    
    results = {
        'health': False,
        'scan': False,
        'ocr': False,
        'packages': False
    }
    
    # Test health first
    results['health'] = test_health_endpoint()
    
    # Test main endpoints
    results['scan'] = test_scan_endpoint()
    results['ocr'] = test_ocr_endpoint()
    results['packages'] = test_packages_endpoint()
    
    # Summary
    print("\n" + "=" * 50)
    print("📊 TEST SUMMARY")
    print("=" * 50)
    
    passed = sum(results.values())
    total = len(results)
    
    for endpoint, success in results.items():
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{endpoint.upper():12} {status}")
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All backend tests PASSED!")
        return True
    else:
        print("⚠️  Some backend tests FAILED!")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)