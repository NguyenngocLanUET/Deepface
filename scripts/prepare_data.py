"""
Prepare and preprocess data for face recognition model training
"""
import os
import json
import shutil
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def prepare_data():
    """Prepare raw data for model training"""
    
    raw_dir = Path("data/raw")
    processed_dir = Path("data/processed")
    
    if not raw_dir.exists():
        logger.warning(f"Raw data directory not found: {raw_dir}")
        os.makedirs(raw_dir, exist_ok=True)
        logger.info(f"Created {raw_dir}")
    
    # Create processed directory
    os.makedirs(processed_dir, exist_ok=True)
    
    logger.info("Preparing data...")
    
    # Count files
    raw_files = list(raw_dir.glob("**/*.jpg")) + list(raw_dir.glob("**/*.png"))
    logger.info(f"Found {len(raw_files)} image files in raw data")
    
    # Copy images to processed directory with folder structure
    for src_file in raw_files:
        rel_path = src_file.relative_to(raw_dir)
        dst_file = processed_dir / rel_path
        os.makedirs(dst_file.parent, exist_ok=True)
        shutil.copy2(src_file, dst_file)
        logger.debug(f"Copied {src_file} to {dst_file}")
    
    # Generate metrics
    metrics = {
        "total_images": len(raw_files),
        "processed_dir": str(processed_dir),
        "status": "success"
    }
    
    with open("data/metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    
    logger.info(f"Data preparation complete. Metrics saved.")
    logger.info(f"Total images processed: {len(raw_files)}")

if __name__ == "__main__":
    prepare_data()
