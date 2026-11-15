# RuView hardware: ESP32 CSI nodes

Adapted from RuView's `plugins/ruview` skills and `docs/user-guide.md` (commit `3686bc7`), with
the upstream author's machine-specific paths removed. **Always ask for the user's serial port**
(`COMx` on Windows, `/dev/ttyUSB0` or `/dev/ttyACM0` on Linux, `/dev/cu.usbmodem*` on macOS).
Never assume one.

## Supported boards

| Board | Notes |
|---|---|
| ESP32-S3, 8 MB | Default CSI node |
| ESP32-S3 SuperMini, 4 MB | Build with `sdkconfig.defaults.4mb` |
| ESP32-C6 | Wi-Fi 6 research node. Same firmware, `idf.py set-target esp32c6` |
| ESP32-C6 + Seeed MR60BHA2 (60 GHz) / HLK-LD2410 (24 GHz) | mmWave radar vitals and presence. Firmware v0.5.0+ auto-detects them and fuses with CSI |
| ESP32-C3, original ESP32 | **Not supported** |

**Warn about tiny clone boards** (S3-Zero, SuperMini and similar). The firmware keeps the radio
on continuously and runs DSP, which is a sustained high current draw. One field report says such
boards overheated and died. Tell the user to give them airflow and to check them by touch for the
first few minutes.

2+ nodes give much better spatial results than one.

## 1. Get firmware

The easiest route is prebuilt binaries from the releases page (tags `v*-esp32`) at
https://github.com/ruvnet/RuView/releases. To build instead (ESP-IDF v5.4+):

```bash
git clone https://github.com/ruvnet/RuView && cd RuView/firmware/esp32-csi-node
idf.py set-target esp32s3   # or esp32c6
idf.py build                # 4 MB board: cp sdkconfig.defaults.4mb sdkconfig.defaults first
```

On Windows, ESP-IDF does not work from Git Bash/MSYS2. Use the ESP-IDF PowerShell/CMD prompt.

## 2. Flash

```bash
python -m esptool --chip esp32s3 --port <PORT> --baud 460800 write_flash \
  0x0 bootloader.bin 0x8000 partition-table.bin 0xf000 ota_data_initial.bin 0x20000 esp32-csi-node.bin
# or, from a build tree: idf.py -p <PORT> flash
```

## 3. Provision WiFi and the server address

`<SERVER_IP>` is the LAN IP of the machine running the sensing server.

```bash
python firmware/esp32-csi-node/provision.py --port <PORT> \
  --ssid "<WIFI>" --password "<PASS>" --target-ip <SERVER_IP> --target-port 5005 --node-id 1
```

> ⚠️ **Provisioning replaces the whole `csi_cfg` NVS namespace.** Any setting not on the command
> line is erased. Pass the full set every time. On Windows, `--help` needs `PYTHONUTF8=1`.

Useful flags (run `--help` for the authoritative list):

| Group | Flags |
|---|---|
| Mesh (TDM) | `--tdm-slot <i> --tdm-total <n>`: 0-based slot and node count, for multi-node setups |
| Edge processing | `--edge-tier 0/1/2` (off / stats / vitals) |
| Thresholds | `--pres-thresh` (50), `--fall-thresh` (15000, i.e. 15.0 rad/s²; raise it in busy rooms) |
| Vitals | `--vital-win` (300 frames), `--vital-int` (1000 ms), `--subk-count` (32) |
| Channel | `--channel <n>` to pin, `--filter-mac <AP-MAC>` for one transmitter, `--hop-channels 1,6,11 --hop-dwell 200` to hop |
| Other | `--dry-run`, `--baud`, Cognitum Seed `--seed-url --seed-token --zone` |

## 4. Run the server so it can hear the nodes

```bash
export RUVIEW_API_TOKEN=$(openssl rand -hex 32)
docker run -d --name ruview -p 127.0.0.1:3000:3000 -p 127.0.0.1:3001:3001 -p 5005:5005/udp \
  -e RUVIEW_API_TOKEN -e CSI_SOURCE=esp32 -e RUVIEW_UDP_ALLOW=192.168.1.0/24 \
  ruvnet/wifi-densepose:latest
```

**macOS Docker Desktop / OrbStack:** packets arrive from the Docker bridge gateway, not the LAN, so
allow the gateway instead:

```bash
GW=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
# ...then use -e RUVIEW_UDP_ALLOW="$GW/32" in the docker run above
```

(With Docker Compose, inspect `<project>_default` instead of `bridge`.)

Confirm: `python scripts/ruview.py health` should show `source` `esp32`, and `python scripts/ruview.py nodes`
should list the boards.

## 5. If no frames arrive

1. Watch the serial log for about 15 s (`idf.py -p <PORT> monitor`, or pyserial at 115200). Look for WiFi
   connected and CSI collector lines.
2. Re-provision with the correct `--target-ip`, and with `--channel` matching your AP.
3. Drop `--filter-mac` if it is set.
4. Check the server's UDP allowlist (above), and that UDP 5005 isn't firewalled on the host.
