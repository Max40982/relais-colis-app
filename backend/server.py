from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime
import aiohttp
import re

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Airtable configuration
AIRTABLE_API_KEY = os.environ.get('AIRTABLE_API_KEY', '')
AIRTABLE_BASE_ID = os.environ.get('AIRTABLE_BASE_ID', '')
AIRTABLE_TABLE_ID = os.environ.get('AIRTABLE_TABLE_ID', '')

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Define Models
class ScanRequest(BaseModel):
    name: str
    
class ScanResponse(BaseModel):
    success: bool
    message: str
    name: str
    is_new: bool
    package_count: int
    record_id: Optional[str] = None

class PackageRecord(BaseModel):
    id: str
    name: str
    numero: int
    statuts: str
    note: Optional[str] = None

class HealthCheck(BaseModel):
    status: str
    airtable_configured: bool

# Airtable API helper functions
async def airtable_request(method: str, endpoint: str, data: dict = None):
    """Make a request to Airtable API"""
    url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{AIRTABLE_TABLE_ID}{endpoint}"
    headers = {
        "Authorization": f"Bearer {AIRTABLE_API_KEY}",
        "Content-Type": "application/json"
    }
    
    async with aiohttp.ClientSession() as session:
        if method == "GET":
            async with session.get(url, headers=headers) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logger.error(f"Airtable GET error: {error_text}")
                    raise HTTPException(status_code=response.status, detail=f"Airtable error: {error_text}")
                return await response.json()
        elif method == "POST":
            async with session.post(url, headers=headers, json=data) as response:
                if response.status not in [200, 201]:
                    error_text = await response.text()
                    logger.error(f"Airtable POST error: {error_text}")
                    raise HTTPException(status_code=response.status, detail=f"Airtable error: {error_text}")
                return await response.json()
        elif method == "PATCH":
            async with session.patch(url, headers=headers, json=data) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logger.error(f"Airtable PATCH error: {error_text}")
                    raise HTTPException(status_code=response.status, detail=f"Airtable error: {error_text}")
                return await response.json()

async def find_recipient_by_name(name: str):
    """Find a recipient by name in Airtable"""
    # URL encode the filter formula
    import urllib.parse
    filter_formula = f"{{Nom}}='{name}'"
    encoded_filter = urllib.parse.quote(filter_formula)
    
    try:
        result = await airtable_request("GET", f"?filterByFormula={encoded_filter}")
        records = result.get("records", [])
        if records:
            return records[0]
        return None
    except Exception as e:
        logger.error(f"Error finding recipient: {e}")
        return None

async def create_recipient(name: str):
    """Create a new recipient in Airtable"""
    data = {
        "records": [{
            "fields": {
                "Nom": name,
                "Numéro": 1,
                "Statuts": "En attente"
            }
        }]
    }
    result = await airtable_request("POST", "", data)
    return result.get("records", [{}])[0]

async def update_recipient_count(record_id: str, current_count: int):
    """Update the package count for an existing recipient"""
    url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{AIRTABLE_TABLE_ID}/{record_id}"
    headers = {
        "Authorization": f"Bearer {AIRTABLE_API_KEY}",
        "Content-Type": "application/json"
    }
    data = {
        "fields": {
            "Numéro": current_count + 1
        }
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.patch(url, headers=headers, json=data) as response:
            if response.status != 200:
                error_text = await response.text()
                logger.error(f"Airtable PATCH error: {error_text}")
                raise HTTPException(status_code=response.status, detail=f"Airtable error: {error_text}")
            return await response.json()

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Relais Colis API"}

@api_router.get("/health", response_model=HealthCheck)
async def health_check():
    """Check API health and Airtable configuration"""
    return HealthCheck(
        status="ok",
        airtable_configured=bool(AIRTABLE_API_KEY and AIRTABLE_BASE_ID and AIRTABLE_TABLE_ID)
    )

@api_router.post("/scan", response_model=ScanResponse)
async def process_scan(request: ScanRequest):
    """Process a scanned package label"""
    name = request.name.strip()
    
    if not name:
        raise HTTPException(status_code=400, detail="Le nom ne peut pas être vide")
    
    # Normalize the name (capitalize first letter of each word)
    name = name.title()
    
    logger.info(f"Processing scan for: {name}")
    
    try:
        # Check if recipient exists
        existing_record = await find_recipient_by_name(name)
        
        if existing_record:
            # Update existing recipient
            record_id = existing_record["id"]
            current_count = existing_record.get("fields", {}).get("Numéro", 0)
            
            await update_recipient_count(record_id, current_count)
            new_count = current_count + 1
            
            logger.info(f"Updated {name}: {current_count} -> {new_count} colis")
            
            return ScanResponse(
                success=True,
                message=f"Mis à jour: {new_count} colis pour {name}",
                name=name,
                is_new=False,
                package_count=new_count,
                record_id=record_id
            )
        else:
            # Create new recipient
            new_record = await create_recipient(name)
            record_id = new_record.get("id")
            
            logger.info(f"Created new recipient: {name}")
            
            return ScanResponse(
                success=True,
                message=f"Nouveau destinataire: {name} (1 colis)",
                name=name,
                is_new=True,
                package_count=1,
                record_id=record_id
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing scan: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors du traitement: {str(e)}")

@api_router.get("/packages", response_model=List[PackageRecord])
async def get_all_packages():
    """Get all packages from Airtable"""
    try:
        # Filter only "En attente" status
        import urllib.parse
        filter_formula = "{Statuts}='En attente'"
        encoded_filter = urllib.parse.quote(filter_formula)
        
        result = await airtable_request("GET", f"?filterByFormula={encoded_filter}&sort%5B0%5D%5Bfield%5D=Nom")
        records = result.get("records", [])
        
        packages = []
        for record in records:
            fields = record.get("fields", {})
            packages.append(PackageRecord(
                id=record["id"],
                name=fields.get("Nom", ""),
                numero=fields.get("Numéro", 0),
                statuts=fields.get("Statuts", ""),
                note=fields.get("Note")
            ))
        
        return packages
    except Exception as e:
        logger.error(f"Error fetching packages: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
