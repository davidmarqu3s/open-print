# ICC profile library

These 15 unmodified third-party CMYK ICC files are bundled into the plugin. Adobe profiles came from David’s existing local Adobe installation; ECI profiles came from official ECI download archives. The files retain their original internal description and copyright tags. Their licences are separate from the plugin’s AGPL licence.

`paths.json` maps the official catalogue IDs to these files. The default build reads this map and bundles all profiles into the plugin. `SHA256SUMS.txt` records the original bytes.

Each supplier sets its own terms, and they differ:

- **Adobe** (Coated FOGRA39, U.S. Web Coated (SWOP) v2, Coated GRACoL 2006, Web Coated SWOP 2006 Grade 3 and Grade 5, Japan Color 2001 Coated, 2001 Uncoated, 2002 Newspaper and 2003 Web Coated, Japan Web Coated (Ad)): https://www.adobe.com/support/downloads/iccprofiles/icc_eula_win_dist.html
- **ECI** (PSO Coated v3, ISO Coated v2 (ECI), ISO Coated v2 300% (ECI), eciCMYK v2): https://eci.org/doku.php_id%3Den_downloads.html and https://registry.color.org/profile-registry/PSOcoated_v3. The copyright tag inside `PSOcoated_v3.icc` says it “may be used, embedded and exchanged without restriction” but “may not be distributed, sold or altered without written permission of ECI European Color Initiative”.
- **Japan Color 2011 Coated** (X-Rite, provided by the Japan Printing Machinery Association): https://japancolor.jp/icc.html

Making the plugin source open source does not change these terms or grant permission to redistribute the ICC files.
