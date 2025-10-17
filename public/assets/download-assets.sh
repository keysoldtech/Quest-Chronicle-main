#!/bin/bash

# Quest Chronicle - Asset Downloader
# Downloads free CC0 pixel art assets

echo "🎨 Downloading free pixel art assets..."
echo ""

# Create temp directory
mkdir -p /tmp/qc-assets
cd /tmp/qc-assets

echo "📦 Step 1: Downloading Kenney Micro Roguelike (CC0)..."
# Kenney's Micro Roguelike - Public Domain
curl -L "https://kenney.nl/content/3-assets/11-micro-roguelike/microRoguelike_1.0.0.zip" -o kenney-micro.zip
if [ -f kenney-micro.zip ]; then
    unzip -q kenney-micro.zip
    echo "✅ Kenney Micro Roguelike downloaded!"
else
    echo "❌ Failed to download Kenney assets"
fi

echo ""
echo "📦 Step 2: Extracting sprites..."

# Go back to project root
cd -

# Copy tiles if extracted
if [ -d "/tmp/qc-assets/Tilesheet" ]; then
    echo "Copying tiles..."
    # This would need manual extraction and renaming
fi

echo ""
echo "⚠️  MANUAL STEPS REQUIRED:"
echo "1. Visit: https://kenney.nl/assets/micro-roguelike"
echo "2. Click 'Download' (free, no account needed)"
echo "3. Extract ZIP file"
echo "4. Copy sprite sheets to public/assets/"
echo ""
echo "OR"
echo ""
echo "Use the simple placeholder assets we created!"
echo "They're already in public/assets/ and work perfectly!"

