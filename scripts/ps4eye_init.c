#if __has_include(<libusb-1.0/libusb.h>)
#include <libusb-1.0/libusb.h>
#else
#include <libusb.h>
#endif
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int scan_ps4eye(libusb_context *ctx) {
    libusb_device **list = NULL;
    ssize_t cnt = libusb_get_device_list(ctx, &list);
    if (cnt < 0 || list == NULL) {
        return 0;
    }
    int found = 0;
    for (ssize_t i = 0; i < cnt; i += 1) {
        struct libusb_device_descriptor desc;
        if (libusb_get_device_descriptor(list[i], &desc) != 0) {
            continue;
        }
        if (desc.idVendor == 0x05a9 && desc.idProduct == 0x058a) {
            found = 1;
            break;
        }
        if (desc.idVendor == 0x05a9 && desc.idProduct == 0x0580) {
            found = 2;
        }
    }
    libusb_free_device_list(list, 1);
    return found;
}

int main(int argc, char **argv) {
    libusb_context *ctx = NULL;
    if (libusb_init(&ctx) != 0) {
        fprintf(stderr, "libusb_init failed\n");
        return 1;
    }

    int status = scan_ps4eye(ctx);
    if (argc > 1 && strcmp(argv[1], "--check") == 0) {
        libusb_exit(ctx);
        if (status == 1) {
            printf("ready\n");
            return 0;
        }
        if (status == 2) {
            printf("boot\n");
            return 10;
        }
        printf("absent\n");
        return 2;
    }

    if (status == 1) {
        printf("ready\n");
        libusb_exit(ctx);
        return 0;
    }
    if (status == 0) {
        printf("absent\n");
        libusb_exit(ctx);
        return 2;
    }

    const char *fw_path = argc > 1 ? argv[1] : "firmware.bin";
    libusb_device_handle *dev = libusb_open_device_with_vid_pid(ctx, 0x05a9, 0x0580);
    if (dev == NULL) {
        fprintf(stderr, "open_boot_failed\n");
        libusb_exit(ctx);
        return 2;
    }

    libusb_set_configuration(dev, 1);

    FILE *fp = fopen(fw_path, "rb");
    if (!fp) {
        fprintf(stderr, "open_firmware_failed\n");
        libusb_close(dev);
        libusb_exit(ctx);
        return 3;
    }

    unsigned char chunk[512];
    uint32_t value = 0;
    uint16_t index = 0x14;
    size_t nread = 0;

    while ((nread = fread(chunk, 1, sizeof(chunk), fp)) > 0) {
        int ret = libusb_control_transfer(dev, 0x40, 0x0, (uint16_t)value, index, chunk, (uint16_t)nread, 5000);
        if (ret != (int)nread) {
            fprintf(stderr, "ctrl_transfer_failed %d\n", ret);
            fclose(fp);
            libusb_close(dev);
            libusb_exit(ctx);
            return 4;
        }
        value += 512;
        if (value >= 65536) {
            value = 0;
            index += 1;
        }
    }
    fclose(fp);

    unsigned char reboot_cmd[1] = {0x5b};
    libusb_control_transfer(dev, 0x40, 0x0, 0x2200, 0x8018, reboot_cmd, 1, 2000);

    libusb_close(dev);
    libusb_exit(ctx);
    printf("initialized\n");
    return 0;
}
