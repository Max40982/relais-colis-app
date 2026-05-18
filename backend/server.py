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
import asyncio

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

class OCRRequest(BaseModel):
    image_base64: str

class OCRResponse(BaseModel):
    success: bool
    name: Optional[str] = None
    raw_text: Optional[str] = None
    message: str
    
class ScanResponse(BaseModel):
    success: bool
    message: str
    name: str
    is_new: bool
    package_count: int
    numero: int
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
    import urllib.parse
    formatted = format_name(name)
    filter_formula = f"AND(LOWER({{Nom}})=LOWER('{formatted}'), {{Statuts}}='En attente')"
    encoded_filter = urllib.parse.quote(filter_formula)
    try:
        result = await airtable_request("GET", f"?filterByFormula={encoded_filter}")
        records = result.get("records", [])
        if records:
            return records[0]
    except Exception as e:
        logger.error(f"Error finding recipient (exact): {e}")
    if name.strip().lower() != formatted.lower():
        filter_formula2 = f"AND(LOWER({{Nom}})=LOWER('{name.strip()}'), {{Statuts}}='En attente')"
        encoded_filter2 = urllib.parse.quote(filter_formula2)
        try:
            result = await airtable_request("GET", f"?filterByFormula={encoded_filter2}")
            records = result.get("records", [])
            if records:
                return records[0]
        except Exception as e:
            logger.error(f"Error finding recipient (raw): {e}")
    parts = name.strip().split()
    if len(parts) >= 2:
        conditions = ["{Statuts}='En attente'"]
        for part in parts:
            part_clean = part.lower().replace("'", "\\'")
            conditions.append(f"FIND('{part_clean}', LOWER({{Nom}}))>0")
        combined_filter = "AND(" + ",".join(conditions) + ")"
        encoded_combined = urllib.parse.quote(combined_filter)
        try:
            result = await airtable_request("GET", f"?filterByFormula={encoded_combined}")
            records = result.get("records", [])
            if records:
                return records[0]
        except Exception as e:
            logger.error(f"Error finding recipient (parts): {e}")
    return None

def format_name(name: str) -> str:
    parts = name.strip().split()
    if len(parts) == 0:
        return name
    elif len(parts) == 1:
        return parts[0].upper()
    all_caps_indices = [i for i, p in enumerate(parts) if p.isupper() and len(p) > 1]
    mixed_case_indices = [i for i, p in enumerate(parts) if not p.isupper() or len(p) <= 1]
    if all_caps_indices and mixed_case_indices:
        surname = ' '.join([parts[i].upper() for i in all_caps_indices])
        firstname = ' '.join([parts[i].capitalize() for i in mixed_case_indices])
        return f"{surname} {firstname}".strip()
    firstnames_set = set()
    try:
        prenoms_path = ROOT_DIR / 'data' / 'prenoms.txt'
        if prenoms_path.exists():
            with open(prenoms_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip().lower()
                    if line:
                        firstnames_set.add(line)
    except Exception:
        pass
    COMMON_FIRSTNAMES = {
        'jean', 'pierre', 'marie', 'anne', 'paul', 'louis', 'jacques', 'michel',
        'philippe', 'alain', 'bernard', 'patrick', 'daniel', 'nicolas', 'stephane',
        'stéphane', 'christophe', 'david', 'eric', 'éric', 'laurent', 'pascal',
        'olivier', 'thierry', 'francois', 'françois', 'bruno', 'vincent', 'claude',
        'sophie', 'nathalie', 'isabelle', 'catherine', 'sylvie', 'christine',
        'martine', 'sandrine', 'valerie', 'valérie', 'caroline', 'julie', 'celine',
        'céline', 'aurelie', 'aurélie', 'emilie', 'émilie', 'marine', 'camille',
        'maxime', 'thomas', 'antoine', 'alexandre', 'julien', 'romain', 'mathieu',
        'kevin', 'sebastien', 'sébastien', 'jerome', 'jérôme', 'arnaud', 'anthony',
        'guillaume', 'florian', 'adrien', 'benjamin', 'cedric', 'cédric', 'damien',
        'fabien', 'franck', 'gregory', 'grégory', 'herve', 'hervé', 'jeremy', 'jérémy',
        'jonathan', 'ludovic', 'marc', 'matthieu', 'mickael', 'mickaël', 'morgan',
        'quentin', 'raphael', 'raphaël', 'remi', 'rémi', 'samuel', 'sylvain', 'xavier',
        'yann', 'yoann', 'charlotte', 'clara', 'clemence', 'clémence', 'emma', 'lea',
        'léa', 'lucie', 'manon', 'margot', 'oceane', 'océane', 'pauline', 'sarah',
        'thomas', 'hugo', 'lucas', 'nathan', 'theo', 'théo', 'tom', 'victor',
        'adam', 'alexis', 'axel', 'baptiste', 'clement', 'clément', 'gabriel',
        'leo', 'léo', 'mathis', 'robin', 'sacha', 'simon', 'valentin', 'yanis',
        'alice', 'anna', 'chloe', 'chloé', 'emma', 'jade', 'lea', 'léa', 'lola',
        'louise', 'lucie', 'manon', 'margot', 'mila', 'rose', 'zoe', 'zoé',
    }
    firstnames_set.update(COMMON_FIRSTNAMES)
    parts_lower = [p.lower() for p in parts]
    firstname_matches = [i for i, p in enumerate(parts_lower) if p in firstnames_set]
    non_firstname_matches = [i for i in range(len(parts)) if i not in firstname_matches]
    if len(firstname_matches) == 1 and len(non_firstname_matches) >= 1:
        firstname = parts[firstname_matches[0]].capitalize()
        surname = ' '.join([parts[i].upper() for i in non_firstname_matches])
        return f"{surname} {firstname}".strip()
    if len(firstname_matches) == 0 or len(firstname_matches) == len(parts):
        surname = parts[0].upper()
        firstname = ' '.join([p.capitalize() for p in parts[1:]])
        return f"{surname} {firstname}".strip()
    firstname_idx = firstname_matches[-1]
    firstname = parts[firstname_idx].capitalize()
    surname_parts = [parts[j].upper() for j in range(len(parts)) if j != firstname_idx]
    surname = ' '.join(surname_parts)
    return f"{surname} {firstname}".strip()

async def get_next_numero():
    import urllib.parse
    try:
        all_numeros = set()
        filter_formula = urllib.parse.quote("{Statuts}='En attente'")
        result = await airtable_request("GET", f"?filterByFormula={filter_formula}&pageSize=100")
        records = result.get("records", [])
        for record in records:
            numero = record.get("fields", {}).get("Numéro", 0)
            if isinstance(numero, int) and numero > 0:
                all_numeros.add(numero)
        offset = result.get("offset")
        while offset:
            result = await airtable_request("GET", f"?filterByFormula={filter_formula}&pageSize=100&offset={offset}")
            records = result.get("records", [])
            for record in records:
                numero = record.get("fields", {}).get("Numéro", 0)
                if isinstance(numero, int) and numero > 0:
                    all_numeros.add(numero)
            offset = result.get("offset")
        if not all_numeros:
            return 1
        next_numero = 1
        while next_numero in all_numeros:
            next_numero += 1
        return next_numero
    except Exception as e:
        logger.error(f"Error getting next numero: {e}")
        import time
        return int(time.time()) % 10000 + 100

async def create_recipient(name: str):
    formatted_name = format_name(name)
    next_numero = await get_next_numero()
    data = {
        "records": [{
            "fields": {
                "Nom": formatted_name,
                "Numéro": next_numero,
                "Statuts": "En attente",
                "Note": "1"
            }
        }]
    }
    result = await airtable_request("POST", "", data)
    return result.get("records", [{}])[0]

async def update_recipient_count(record_id: str, current_note: str):
    url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{AIRTABLE_TABLE_ID}/{record_id}"
    headers = {
        "Authorization": f"Bearer {AIRTABLE_API_KEY}",
        "Content-Type": "application/json"
    }
    if current_note and current_note.strip().isdigit():
        new_count = int(current_note.strip()) + 1
    else:
        new_count = 2
    data = {"fields": {"Note": str(new_count)}}
    async with aiohttp.ClientSession() as session:
        async with session.patch(url, headers=headers, json=data) as response:
            response_json = await response.json()
            if response.status != 200:
                raise HTTPException(status_code=response.status, detail=f"Airtable error: {str(response_json)}")
            return response_json, new_count

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Relais Colis API"}

@api_router.get("/health", response_model=HealthCheck)
async def health_check():
    return HealthCheck(
        status="ok",
        airtable_configured=bool(AIRTABLE_API_KEY and AIRTABLE_BASE_ID and AIRTABLE_TABLE_ID)
    )

@api_router.post("/ocr", response_model=OCRResponse)
async def extract_name_from_image(request: OCRRequest):
    """Extract recipient name from package label image using AI Vision"""
    try:
        from openai import AsyncOpenAI

        api_key = os.environ.get('OPENAI_API_KEY', '')
        if not api_key:
            raise HTTPException(status_code=500, detail="OCR non configuré")

        image_base64 = request.image_base64
        if ',' in image_base64:
            image_base64 = image_base64.split(',')[1]

        ocr_client = AsyncOpenAI(api_key=api_key)

        ocr_response = await ocr_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "Tu lis le TEXTE sur une étiquette de colis postal. Tu dois extraire le NOM DE FAMILLE et le PRÉNOM du destinataire. RÈGLES: 1) Sur les étiquettes, le NOM DE FAMILLE est en MAJUSCULES. 2) Réponds UNIQUEMENT avec: NOM_DE_FAMILLE Prénom (nom en MAJUSCULES, prénom en minuscule avec majuscule initiale). 3) Si pas de nom visible, réponds exactement: INCONNU. 4) Aucune explication, aucune phrase, juste le nom."
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}
                        },
                        {
                            "type": "text",
                            "text": "Lis cette étiquette de colis. Donne-moi UNIQUEMENT le nom du destinataire au format: NOM Prénom. Rien d'autre."
                        }
                    ]
                }
            ],
            max_tokens=100
        )

        extracted_name = ocr_response.choices[0].message.content.strip()
        logger.info(f"OCR raw response: '{extracted_name}'")

        extracted_name = extracted_name.strip('"\'.,;:!?()[]{}').strip()
        if '\n' in extracted_name:
            extracted_name = extracted_name.split('\n')[0].strip()

        prefixes_to_remove = [
            'le nom du destinataire est', 'le destinataire est',
            'nom du destinataire:', 'nom du destinataire :',
            'destinataire:', 'destinataire :', 'nom:', 'nom :',
        ]
        extracted_lower_check = extracted_name.lower().strip()
        for prefix in prefixes_to_remove:
            if extracted_lower_check.startswith(prefix):
                extracted_name = extracted_name[len(prefix):].strip()
                extracted_name = extracted_name.strip('"\'.,;:!?').strip()
                break

        invalid_phrases = [
            'inconnu', 'je ne peux', 'je ne suis pas en mesure',
            'i cannot', "i can't", 'impossible de', 'pas de nom',
            'aucun nom', 'no name', 'not able to', 'unable to',
            'désolé', 'sorry', "il n'y a pas", "je n'arrive pas",
            'image ne contient', 'pas lisible', 'illisible',
        ]
        extracted_lower = extracted_name.lower().strip()
        is_invalid = (
            not extracted_name
            or len(extracted_name) < 2
            or extracted_lower == 'inconnu'
            or any(phrase in extracted_lower for phrase in invalid_phrases)
            or len(extracted_name) > 80
        )

        if is_invalid:
            return OCRResponse(
                success=False, name=None, raw_text=extracted_name,
                message="Nom non trouvé sur l'étiquette. Réessayez ou mode manuel."
            )

        words = extracted_name.split()
        if len(words) > 4:
            extracted_name = ' '.join(words[:3])

        logger.info(f"OCR extracted name: {extracted_name}")
        return OCRResponse(
            success=True, name=extracted_name, raw_text=extracted_name,
            message=f"Nom extrait: {extracted_name}"
        )

    except Exception as e:
        logger.error(f"OCR error: {e}")
        return OCRResponse(
            success=False, name=None, raw_text=None,
            message=f"Erreur OCR: {str(e)}"
        )

@api_router.post("/scan", response_model=ScanResponse)
async def process_scan(request: ScanRequest):
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Le nom ne peut pas être vide")
    formatted_name = format_name(name)
    logger.info(f"Processing scan for: {formatted_name} (original: {name})")
    try:
        existing_record = await find_recipient_by_name(name)
        if existing_record:
            record_id = existing_record["id"]
            existing_name = existing_record.get("fields", {}).get("Nom", formatted_name)
            existing_numero = existing_record.get("fields", {}).get("Numéro", 0)
            current_note = existing_record.get("fields", {}).get("Note", "")
            result, new_count = await update_recipient_count(record_id, current_note)
            return ScanResponse(
                success=True, message=f"Mis à jour: {new_count} colis pour {existing_name}",
                name=existing_name, is_new=False, package_count=new_count,
                numero=existing_numero, record_id=record_id
            )
        else:
            new_record = await create_recipient(name)
            record_id = new_record.get("id")
            created_name = new_record.get("fields", {}).get("Nom", formatted_name)
            created_numero = new_record.get("fields", {}).get("Numéro", 0)
            return ScanResponse(
                success=True, message=f"Nouveau destinataire: {created_name} (1 colis)",
                name=created_name, is_new=True, package_count=1,
                numero=created_numero, record_id=record_id
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing scan: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors du traitement: {str(e)}")

@api_router.get("/packages", response_model=List[PackageRecord])
async def get_all_packages():
    try:
        import urllib.parse
        filter_formula = "{Statuts}='En attente'"
        encoded_filter = urllib.parse.quote(filter_formula)
        result = await airtable_request("GET", f"?filterByFormula={encoded_filter}&sort%5B0%5D%5Bfield%5D=Nom")
        records = result.get("records", [])
        packages = []
        for record in records:
            fields = record.get("fields", {})
            packages.append(PackageRecord(
                id=record["id"], name=fields.get("Nom", ""),
                numero=fields.get("Numéro", 0), statuts=fields.get("Statuts", ""),
                note=fields.get("Note")
            ))
        return packages
    except Exception as e:
        logger.error(f"Error fetching packages: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")

@api_router.get("/suggest")
async def suggest_names(q: str = ""):
    if not q or len(q) < 2:
        return []
    import urllib.parse
    try:
        filter_formula = f"FIND(LOWER('{q.strip()}'), LOWER({{Nom}}))>0"
        encoded_filter = urllib.parse.quote(filter_formula)
        result = await airtable_request("GET", f"?filterByFormula={encoded_filter}&sort%5B0%5D%5Bfield%5D=Nom")
        records = result.get("records", [])
        seen = set()
        names = []
        for record in records:
            name = record.get("fields", {}).get("Nom", "").strip()
            name_lower = name.lower()
            if name and name_lower not in seen:
                seen.add(name_lower)
                names.append(name)
        return names[:10]
    except Exception as e:
        logger.error(f"Error suggesting names: {e}")
        return []

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
