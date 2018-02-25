#!/usr/bin/env python
# coding: utf-8
# vim:set noet ts=4 sw=4:

"""
This Python and JavaScript software simulates a LED strip compatible with pyledstrip.
"""

__author__ = 'Michael Cipold'
__email__ = 'github@cipold.de'
__license__ = 'MPL-2.0'

import argparse
import json
import signal
import socket
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from itertools import zip_longest
from os.path import isfile
from threading import Thread

from pyledstrip import LedStrip


class HttpHandler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        self.send_response(200)
        self.send_header('Content-type', 'text/html')
        self.end_headers()

    def do_GET(self):
        # Check registered data keywords first
        key = self.path[1:]
        if key in self.server.registered_keys:
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(self.server.registered_keys[key]()).encode('utf-8'))
            return

        # Try serving from files
        if self.path == '/':
            print('Main page opened')
            file_path = 'www/index.html'
        else:
            file_path = 'www/' + self.path[1:]

        # Check if file exists
        if not isfile(file_path):
            self.send_response(404)
            self.end_headers()
            return

        # Serve file
        self.send_response(200)
        self.send_header('Content-type', self.get_mime_type(file_path))
        self.end_headers()
        self.wfile.write(open(file_path, 'rb').read())

    @staticmethod
    def get_mime_type(file_path):
        if file_path.endswith('.html'):
            return 'text/html'
        elif file_path.endswith('.js'):
            return 'text/javascript'
        elif file_path.endswith('.css'):
            return 'text/css'
        else:
            return 'application/octet-stream'

    def log_message(self, format, *args):
        return


class WebServer(HTTPServer):
    thread = None
    registered_keys = {}

    def __init__(self, ip, port):
        super().__init__((ip, port), HttpHandler)

    def run_blocking(self):
        self.serve_forever()
        print('HTTP server stopped')

    def run_background(self):
        self.thread = Thread(target=self.run_blocking)
        self.thread.start()

    def stop(self):
        self.shutdown()

        if self.thread is not None:
            self.thread.join()

    def register_key(self, key, f):
        self.registered_keys[key] = f


class LedServer:
    MAX_LED_COUNT = 1000

    ip = None
    port = None
    stop = False
    last_client = ''
    data_updates = 0
    pixels = []
    debug = False

    def __init__(self, ip, port, debug=False):
        self.ip = ip
        self.port = port
        self.debug = debug

        signal.signal(signal.SIGINT, self._signal_handler)

    def run_blocking(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind((self.ip, self.port))

        while not self.stop:
            try:
                data, client_address = sock.recvfrom(LedStrip.DATA_OFFSET + self.MAX_LED_COUNT * 3)
            except InterruptedError:
                continue

            self.last_client = client_address
            if self.debug:
                print('%d bytes received from %s' % (len(data), client_address))

            if len(data) < 4 or len(data) % 3 != 0:
                print('Invalid data packet size received')
                continue

            self.data_updates += 1
            pixel_groups = [iter(data[LedStrip.DATA_OFFSET:])] * 3

            self.pixels = [
                [
                    pixel_group[LedStrip.RED_OFFSET],
                    pixel_group[LedStrip.GREEN_OFFSET],
                    pixel_group[LedStrip.BLUE_OFFSET]
                ] for pixel_group in zip_longest(*pixel_groups)
            ]

        print('UDP server stopped')

    def _signal_handler(self, signum, _frame):
        if signum == signal.SIGINT:
            self.stop = True
            raise InterruptedError


def string_from_file(filename):
    with open(filename, "r") as text_file:
        return text_file.read()


def map_from_file(filename):
    """
    read map from file created by pyledstrip-detector.

    sample data can be created as follows:

    result = []
    for i in range(300):
        entry = {
            "id": i,
            "x": (i + 150) - 16 * math.sin(1.99 * (i + 150) / 10),
            "y": 40 * math.sin((i + 150) / 10) + 5 * math.sin((i + 150) / 22)
        }
        result.append(entry)

    return json.dumps(result, indent=2)


    :param filename: path to file
    :return: internal data structure
    """
    leds = json.loads(string_from_file(filename))
    hashed_leds = {}
    for led in leds:
        hashed_leds[led["id"]] = led

    max_id = max(hashed_leds.keys())

    # fill missing leds
    for i in range(0, max_id):
        if i not in hashed_leds:
            if i - 1 in hashed_leds:
                hashed_leds[i] = hashed_leds[i - 1]
            else:
                hashed_leds[i] = hashed_leds[max_id]

    # convert to this tool's format
    return [
        [led["x"], led["y"]] for sort_the_id, led in sorted(hashed_leds.items())
    ]


def main(args):
    # Initialize servers
    led_server = LedServer(
        '0.0.0.0' if args.led_public else '127.0.0.1',
        args.led_port,
        args.debug)
    web_server = WebServer('0.0.0.0' if args.http_public else '127.0.0.1', args.http_port)

    web_server.register_key('data', lambda: {
        'pixels': led_server.pixels,
        'last_client': led_server.last_client,
        'data_updates': led_server.data_updates
    })
    web_server.register_key('map', lambda: {
        'map': map_from_file(args.heightmapfile)
    })

    # Run web server in background thread
    web_server.run_background()

    # Open web browser
    if not args.no_browser:
        webbrowser.open_new('http://127.0.0.1:%d' % args.http_port)

    # Run LED server blocking
    led_server.run_blocking()

    # Stop and wait for web server
    web_server.stop()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='pyledstrip Simulator.')
    parser.add_argument('--led_port', type=int, default=7777,
                        help='Port for LED strip simulator')
    parser.add_argument('--led_public', type=bool, default=False,
                        help='Accept LED data from all IP addresses, not only localhost')
    parser.add_argument('--http_port', type=int, default=8000,
                        help='Port for web interface')
    parser.add_argument('--http_public', type=bool, default=False,
                        help='Accept HTTP from all IP addresses, not only localhost')
    parser.add_argument('--heightmapfile', type=str, default="data/heightmap.default.json",
                        help='File with heightmap data')
    parser.add_argument('--no_browser', type=bool, default=False,
                        help='Do not open browser on start')
    parser.add_argument('--debug', type=bool, default=False,
                        help='Enable debug output')

    main(parser.parse_args())
