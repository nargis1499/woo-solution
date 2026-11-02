"""Vendor pinned Fontsource Latin normal WOFF2 files and upstream licenses.

Run from the repository root. Only Python's standard library and npm registry
access are required; font packages are not application runtime dependencies.
"""

import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "src/lib/typography/assets.json"
DESTINATION = ROOT / "public/fonts"
FAMILIES = (
    "Inter", "Poppins", "Roboto", "DM Sans", "Montserrat", "Plus Jakarta Sans",
    "Open Sans", "Lato", "Playfair Display", "Manrope", "Outfit", "Nunito Sans",
    "Lora", "Source Sans 3", "Work Sans", "Rubik", "Sora", "Space Grotesk",
    "Oswald", "Merriweather", "Geist", "IBM Plex Sans", "Public Sans",
)
USED_WEIGHTS = ("400", "500", "600", "700", "800", "900")


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read()


def main():
    previous = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    manifest = {}
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for name in FAMILIES:
        slug = name.lower().replace(" ", "-")
        static = name in ("Poppins", "Lato")
        package = ("@fontsource/" if static else "@fontsource-variable/") + slug
        version = previous.get(name, {}).get(
            "version", "5.3.1" if name == "Source Sans 3" else "5.3.0"
        )
        metadata = json.loads(fetch(f"https://registry.npmjs.org/{package}/{version}"))
        files = []
        with tarfile.open(fileobj=io.BytesIO(fetch(metadata["dist"]["tarball"]))) as archive:
            font_metadata = json.load(archive.extractfile("package/metadata.json"))
            variable = font_metadata.get("variable")
            axis = variable["wght"] if isinstance(variable, dict) else {
                "min": min(font_metadata["weights"]),
                "max": max(font_metadata["weights"]),
            }
            for member in archive.getmembers():
                filename = Path(member.name).name
                if filename in ("OFL.txt", "LICENSE", "LICENSE.txt"):
                    (DESTINATION / f"{slug}-LICENSE.txt").write_bytes(
                        archive.extractfile(member).read()
                    )
                if (
                    not filename.endswith(".woff2")
                    or "-latin-" not in filename
                    or "-latin-ext-" in filename
                    or "normal" not in filename
                ):
                    continue
                if static:
                    if not any(f"-{weight}-normal" in filename for weight in USED_WEIGHTS):
                        continue
                    weight = re.search(r"-(\d+)-normal", filename).group(1)
                else:
                    # Choose the standard wght face, not additional axis variants.
                    if not filename.endswith("-wght-normal.woff2"):
                        continue
                    weight = f"{axis['min']} {axis['max']}"
                blob = archive.extractfile(member).read()
                digest = hashlib.sha256(blob).hexdigest()[:12]
                asset = f"{slug}-{digest}.woff2"
                (DESTINATION / asset).write_bytes(blob)
                files.append({"url": f"/fonts/{asset}", "weight": weight})
        if not files or not (DESTINATION / f"{slug}-LICENSE.txt").exists():
            raise RuntimeError(f"Missing font files or license for {name}")
        manifest[name] = {
            "package": package,
            "version": metadata["version"],
            "files": list({file["url"]: file for file in files}.values()),
        }
        print(name, metadata["version"], len(files))
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
