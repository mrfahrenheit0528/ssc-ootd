"""Supabase RPC transport. Only scoped device credentials are kept on the PC."""
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class CloudClient:
    def __init__(self, url, publishable_key, device_id, device_token):
        self.url = url.rstrip('/')
        self.key = publishable_key
        self.device_id = device_id
        self.token = device_token

    def rpc(self, name, **params):
        payload = {'p_device_id': self.device_id, 'p_token': self.token, **params}
        request = Request(f'{self.url}/rest/v1/rpc/{name}',
                          data=json.dumps(payload).encode(), method='POST',
                          headers={'apikey': self.key, 'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=3 if name == 'reader_tap' else 10) as response:
                return json.load(response)
        except HTTPError as exc:
            # Do not include request bodies, headers, or device tokens in logs.
            raise ConnectionError(f'Supabase request failed (HTTP {exc.code}); check project setup and reader credentials.') from None

    def context(self):
        return self.rpc('reader_context')

    def tap(self, uid):
        return self.rpc('reader_tap', p_uid=uid)

    def ingest(self, events):
        return self.rpc('ingest_attendance', p_events=events)
