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

# Emergent LLM Key for OCR
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

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
    """Find a recipient by name in Airtable (case insensitive)"""
    import urllib.parse
    
    # Use LOWER() for case-insensitive search
    filter_formula = f"LOWER({{Nom}})=LOWER('{name}')"
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

def format_name(name: str) -> str:
    """Format name as 'NOM Prénom' - surname uppercase, firstname capitalized"""
    
    # Liste de prénoms français courants (pour éviter de les confondre avec des noms)
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
        'léa', 'lucie', 'manon', 'margot', 'marie', 'oceane', 'océane', 'pauline',
        'sarah', 'amandine', 'audrey', 'laetitia', 'laëtitia', 'laura', 'marie-pierre',
        'patricia', 'virginie', 'alexandra', 'alexia', 'amelie', 'amélie', 'anais',
        'anaïs', 'angélique', 'angelique', 'aurore', 'carole', 'charline', 'cindy',
        'coralie', 'delphine', 'doriane', 'elise', 'élise', 'elodie', 'élodie',
        'estelle', 'eva', 'fanny', 'florine', 'helene', 'hélène', 'jessica', 'justine',
        'karen', 'karine', 'kelly', 'kim', 'laurie', 'linda', 'lisa', 'lola', 'louise',
        'lucile', 'lydia', 'madeleine', 'magali', 'maeva', 'maëva', 'marion', 'melanie',
        'mélanie', 'melissa', 'mélissa', 'morgane', 'muriel', 'myriam', 'nadege',
        'nadège', 'nina', 'ophelie', 'ophélie', 'rachel', 'sabrina', 'salome', 'salomé',
        'solene', 'solène', 'stephanie', 'stéphanie', 'vanessa', 'veronique', 'véronique',
        'bastien', 'corentin', 'dorian', 'dylan', 'enzo', 'evan', 'florent', 'hugo',
        'jordan', 'killian', 'kylian', 'leo', 'léo', 'logan', 'lucas', 'luca', 'malo',
        'martin', 'matteo', 'nathan', 'nolan', 'noah', 'noé', 'robin', 'ryan', 'theo',
        'théo', 'titouan', 'tom', 'tristan', 'valentin', 'victor', 'william', 'yanis',
        'adam', 'alexis', 'axel', 'baptiste', 'bryan', 'clement', 'clément', 'esteban',
        'ethan', 'gabriel', 'gauthier', 'gautier', 'loic', 'loïc', 'lilian', 'loan',
        'maël', 'mael', 'mathis', 'mattéo', 'mehdi', 'noe', 'pierre-louis', 'rayan',
        'sacha', 'simon', 'thibault', 'thibaut', 'timeo', 'timéo', 'alexia', 'lina',
        'ines', 'inès', 'jade', 'lena', 'léna', 'lilou', 'maëlle', 'maelle', 'mila',
        'noemie', 'noémie', 'romane', 'rose', 'zoe', 'zoé', 'alice', 'anna', 'chloe',
        'chloé', 'elena', 'eléna', 'elsa', 'lily', 'louna', 'luna', 'louise', 'maya',
        # Prénoms composés courants
        'jean-pierre', 'jean-paul', 'jean-louis', 'jean-marc', 'jean-claude',
        'jean-philippe', 'jean-michel', 'jean-francois', 'jean-françois',
        'marie-claire', 'marie-france', 'marie-helene', 'marie-hélène',
        'anne-marie', 'anne-sophie', 'anne-laure',
    }
    
    parts = name.strip().split()
    if len(parts) == 0:
        return name
    elif len(parts) == 1:
        return parts[0].upper()
    
    # Convertir en minuscules pour comparaison
    parts_lower = [p.lower() for p in parts]
    
    # Chercher quel mot est un prénom connu
    firstname_idx = -1
    surname_idx = -1
    
    for i, p_lower in enumerate(parts_lower):
        if p_lower in COMMON_FIRSTNAMES:
            firstname_idx = i
            break
    
    if firstname_idx >= 0:
        # On a trouvé un prénom - le reste est le nom de famille
        firstname = parts[firstname_idx].capitalize()
        surname_parts = [parts[j].upper() for j in range(len(parts)) if j != firstname_idx]
        surname = ' '.join(surname_parts)
        return f"{surname} {firstname}".strip()
    
    # Pas de prénom trouvé dans la liste - utiliser l'ancienne logique
    # Chercher si un mot est en majuscules (probablement le nom)
    uppercase_idx = -1
    for i, part in enumerate(parts):
        if part.isupper() and len(part) > 1:
            uppercase_idx = i
            break
    
    if uppercase_idx >= 0:
        surname = parts[uppercase_idx].upper()
        firstname_parts = [p.capitalize() for j, p in enumerate(parts) if j != uppercase_idx]
        firstname = ' '.join(firstname_parts)
        return f"{surname} {firstname}".strip()
    else:
        # Assumer que le dernier mot est le nom (convention française)
        surname = parts[-1].upper()
        firstname = ' '.join([p.capitalize() for p in parts[:-1]])
        return f"{surname} {firstname}".strip()

async def get_next_numero():
    """Get the next available unique numero (finds first gap - only counts 'En attente' status)"""
    import urllib.parse
    try:
        # Get only records with "En attente" status
        all_numeros = set()
        page_count = 0
        
        filter_formula = urllib.parse.quote("{Statuts}='En attente'")
        
        result = await airtable_request("GET", f"?filterByFormula={filter_formula}&pageSize=100")
        records = result.get("records", [])
        page_count += 1
        
        for record in records:
            numero = record.get("fields", {}).get("Numéro", 0)
            if isinstance(numero, int) and numero > 0:
                all_numeros.add(numero)
        
        logger.info(f"Page {page_count}: got {len(records)} 'En attente' records, {len(all_numeros)} unique numeros")
        
        # If there are more pages, continue fetching
        offset = result.get("offset")
        while offset:
            result = await airtable_request("GET", f"?filterByFormula={filter_formula}&pageSize=100&offset={offset}")
            records = result.get("records", [])
            page_count += 1
            
            for record in records:
                numero = record.get("fields", {}).get("Numéro", 0)
                if isinstance(numero, int) and numero > 0:
                    all_numeros.add(numero)
            
            offset = result.get("offset")
        
        logger.info(f"Total: Found {len(all_numeros)} unique numeros in 'En attente' records")
        
        # Find the first available numero (first gap in sequence)
        if not all_numeros:
            return 1
        
        # Start from 1 and find the first missing number
        next_numero = 1
        while next_numero in all_numeros:
            next_numero += 1
        
        logger.info(f"Next available numero: {next_numero}")
        return next_numero
        
    except Exception as e:
        logger.error(f"Error getting next numero: {e}")
        # Fallback: return a high number based on timestamp
        import time
        return int(time.time()) % 10000 + 100

async def create_recipient(name: str):
    """Create a new recipient in Airtable with unique numero"""
    formatted_name = format_name(name)
    
    # Get the next unique numero
    next_numero = await get_next_numero()
    
    data = {
        "records": [{
            "fields": {
                "Nom": formatted_name,
                "Numéro": next_numero,
                "Statuts": "En attente"
            }
        }]
    }
    
    logger.info(f"Creating recipient {formatted_name} with Numéro {next_numero}")
    
    result = await airtable_request("POST", "", data)
    return result.get("records", [{}])[0]

async def update_recipient_count(record_id: str, current_note: str):
    """Update the package count in Note column for an existing recipient"""
    url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{AIRTABLE_TABLE_ID}/{record_id}"
    headers = {
        "Authorization": f"Bearer {AIRTABLE_API_KEY}",
        "Content-Type": "application/json"
    }
    
    # Calculate new note value (increment counter)
    if current_note and current_note.strip().isdigit():
        new_count = int(current_note.strip()) + 1
    else:
        # If note is empty or not a number, this is the 2nd package
        new_count = 2
    
    data = {
        "fields": {
            "Note": str(new_count)
        }
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.patch(url, headers=headers, json=data) as response:
            if response.status != 200:
                error_text = await response.text()
                logger.error(f"Airtable PATCH error: {error_text}")
                raise HTTPException(status_code=response.status, detail=f"Airtable error: {error_text}")
            return await response.json(), new_count

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

@api_router.post("/ocr", response_model=OCRResponse)
async def extract_name_from_image(request: OCRRequest):
    """Extract recipient name from package label image using AI Vision"""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        
        if not EMERGENT_LLM_KEY:
            raise HTTPException(status_code=500, detail="OCR non configuré")
        
        # Clean base64 string (remove data:image prefix if present)
        image_base64 = request.image_base64
        if ',' in image_base64:
            image_base64 = image_base64.split(',')[1]
        
        # Initialize chat with vision model
        # Use gpt-4o for vision (fast enough with short prompt)
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"ocr-{uuid.uuid4()}",
            system_message="Extrait NOM Prénom. NOM en MAJUSCULES. Ex: DUPONT Jean"
        ).with_model("openai", "gpt-4o")
        
        # Create image content
        image_content = ImageContent(image_base64=image_base64)
        
        # Ultra short prompt
        user_message = UserMessage(
            text="Nom?",
            file_contents=[image_content]
        )
        
        response = await chat.send_message(user_message)
        
        extracted_name = response.strip()
        
        # Validate the extracted name
        if not extracted_name or extracted_name.upper() == "INCONNU" or len(extracted_name) < 2:
            return OCRResponse(
                success=False,
                name=None,
                raw_text=extracted_name,
                message="Impossible de trouver le nom du destinataire sur l'étiquette"
            )
        
        # Clean up the name (remove quotes, extra spaces)
        extracted_name = extracted_name.strip('"\'').strip()
        
        logger.info(f"OCR extracted name: {extracted_name}")
        
        return OCRResponse(
            success=True,
            name=extracted_name,
            raw_text=extracted_name,
            message=f"Nom extrait: {extracted_name}"
        )
        
    except Exception as e:
        logger.error(f"OCR error: {e}")
        return OCRResponse(
            success=False,
            name=None,
            raw_text=None,
            message=f"Erreur OCR: {str(e)}"
        )

@api_router.post("/scan", response_model=ScanResponse)
async def process_scan(request: ScanRequest):
    """Process a scanned package label"""
    name = request.name.strip()
    
    if not name:
        raise HTTPException(status_code=400, detail="Le nom ne peut pas être vide")
    
    # Format the name (NOM Prénom)
    formatted_name = format_name(name)
    
    logger.info(f"Processing scan for: {formatted_name} (original: {name})")
    
    try:
        # Check if recipient exists (case insensitive search)
        existing_record = await find_recipient_by_name(name)
        
        if existing_record:
            # Update existing recipient - increment Note column
            record_id = existing_record["id"]
            existing_name = existing_record.get("fields", {}).get("Nom", formatted_name)
            existing_numero = existing_record.get("fields", {}).get("Numéro", 0)
            current_note = existing_record.get("fields", {}).get("Note", "")
            
            result, new_count = await update_recipient_count(record_id, current_note)
            
            logger.info(f"Updated {existing_name}: Note -> {new_count} colis")
            
            return ScanResponse(
                success=True,
                message=f"Mis à jour: {new_count} colis pour {existing_name}",
                name=existing_name,
                is_new=False,
                package_count=new_count,
                numero=existing_numero,
                record_id=record_id
            )
        else:
            # Create new recipient
            new_record = await create_recipient(name)
            record_id = new_record.get("id")
            created_name = new_record.get("fields", {}).get("Nom", formatted_name)
            created_numero = new_record.get("fields", {}).get("Numéro", 0)
            
            logger.info(f"Created new recipient: {created_name} with numero {created_numero}")
            
            return ScanResponse(
                success=True,
                message=f"Nouveau destinataire: {created_name} (1 colis)",
                name=created_name,
                is_new=True,
                package_count=1,
                numero=created_numero,
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
