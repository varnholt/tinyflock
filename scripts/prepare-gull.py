"""Compatibility entry point for the reusable gull asset pipeline."""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parents[1] / 'assets/gull/build.py'), run_name='__main__')
