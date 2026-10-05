# Private ICC profile library

These 15 unmodified third-party CMYK ICC files are included for David’s personal use in this private repository. Adobe profiles came from his existing local Adobe installation; ECI profiles came from official ECI download archives. The files retain their original internal description and copyright tags. Their licenses are separate from the plugin’s AGPL license.

`paths.json` maps the official catalog IDs to these files. The default build reads this map and bundles all profiles into the offline plugin. `SHA256SUMS.txt` records the original bytes.

Source terms:

- Adobe: https://www.adobe.com/support/downloads/iccprofiles/icc_eula_win_dist.html
- ECI: https://eci.org/doku.php_id%3Den_downloads.html
- PSO Coated v3: https://registry.color.org/profile-registry/PSOcoated_v3
- Japan Color 2011: https://japancolor.jp/icc.html

Keep this repository and profile-bearing release artifacts private. Making the plugin source open source does not grant permission to redistribute these ICC files.
