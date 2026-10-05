#!/bin/bash
# Deletes the trial's records and photos; the next start begins again with fresh sample data.
cd "$(dirname "$0")"
read -r -p "Delete all trial records and photos? (y/N) " a
if [ "$a" = "y" ] || [ "$a" = "Y" ]; then rm -rf trial-data && echo "Done. Run start.command again."; else echo "Nothing deleted."; fi
read -r -p "Press Enter to close." _
