#!/bin/bash
# Download short, pleasant sound effects

# Attack sounds - shorter, less harsh
curl -s "https://cdn.pixabay.com/download/audio/2021/08/04/audio_12b0c7443c.mp3?filename=sword-sound-2-36274.mp3" -o attack.mp3
curl -s "https://cdn.pixabay.com/download/audio/2022/03/24/audio_c610215e26.mp3?filename=punch-2-37333.mp3" -o hit.mp3  
curl -s "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=metal-hit-with-reverb-88403.mp3" -o critical.mp3

# Magic sounds - ethereal and quick
curl -s "https://cdn.pixabay.com/download/audio/2022/03/15/audio_4e3c1d6729.mp3?filename=magic-spell-6005.mp3" -o spell-cast.mp3
curl -s "https://cdn.pixabay.com/download/audio/2022/05/11/audio_b9135a8b28.mp3?filename=goodresult-82807.mp3" -o heal.mp3
curl -s "https://cdn.pixabay.com/download/audio/2021/08/09/audio_bb630cc098.mp3?filename=level-up-191997.mp3" -o level-up.mp3

# UI sounds - very short and pleasant
curl -s "https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3?filename=button-124476.mp3" -o button-click.mp3
curl -s "https://cdn.pixabay.com/download/audio/2022/03/22/audio_1574d79df9.mp3?filename=game-bonus-144751.mp3" -o card-play.mp3

# Victory/defeat - short musical cues
curl -s "https://cdn.pixabay.com/download/audio/2021/08/09/audio_c03f9038ba.mp3?filename=success-1-6297.mp3" -o victory.mp3
curl -s "https://cdn.pixabay.com/download/audio/2022/04/27/audio_a45d286015.mp3?filename=error-126627.mp3" -o defeat.mp3

# Monster sounds - short and impactful
curl -s "https://cdn.pixabay.com/download/audio/2022/03/24/audio_e6c0f33e68.mp3?filename=punch-1-37333.mp3" -o monster-hit.mp3
curl -s "https://cdn.pixabay.com/download/audio/2021/11/26/audio_26f5394f41.mp3?filename=cartoon-death-sound-45091.mp3" -o monster-death.mp3
curl -s "https://cdn.pixabay.com/download/audio/2022/03/15/audio_c68deb8ba7.mp3?filename=spell-1-6144.mp3" -o monster-spawn.mp3

# Buff and miss - subtle
curl -s "https://cdn.pixabay.com/download/audio/2022/03/15/audio_8621ee501b.mp3?filename=shimmer-spread-1-43820.mp3" -o buff.mp3
curl -s "https://cdn.pixabay.com/download/audio/2022/03/10/audio_4dedf2bbf5.mp3?filename=whoosh-6316.mp3" -o miss.mp3

echo "All sounds downloaded!"
