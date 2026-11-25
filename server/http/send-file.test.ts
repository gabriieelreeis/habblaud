import type { ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { sendFile } from './app';

const response = () => ({ writeHead: vi.fn(), end: vi.fn() }) as unknown as ServerResponse;

describe('sendFile for audio', () => {
  it('sends the whole file with the media type and byte ranges advertised', () => {
    const res = response();
    sendFile(res, Buffer.from('abcdef'), 'audio/wav', 'voz.wav');
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'audio/wav', 'Content-Length': 6, 'Accept-Ranges': 'bytes' }));
    expect(res.end).toHaveBeenCalledWith(Buffer.from('abcdef'));
  });

  it('answers a byte range with 206 so mobile audio can seek', () => {
    const res = response();
    sendFile(res, Buffer.from('abcdef'), 'audio/wav', 'voz.wav', 'bytes=2-4');
    expect(res.writeHead).toHaveBeenCalledWith(206, expect.objectContaining({ 'Content-Type': 'audio/wav', 'Content-Length': 3, 'Content-Range': 'bytes 2-4/6' }));
    expect(res.end).toHaveBeenCalledWith(Buffer.from('cde'));
  });

  it('accepts open and suffix ranges and ignores an impossible one', () => {
    const open = response();
    sendFile(open, Buffer.from('abcdef'), 'audio/mpeg', 'voz.mp3', 'bytes=4-');
    expect(open.writeHead).toHaveBeenCalledWith(206, expect.objectContaining({ 'Content-Range': 'bytes 4-5/6' }));
    expect(open.end).toHaveBeenCalledWith(Buffer.from('ef'));

    const suffix = response();
    sendFile(suffix, Buffer.from('abcdef'), 'audio/mpeg', 'voz.mp3', 'bytes=-2');
    expect(suffix.end).toHaveBeenCalledWith(Buffer.from('ef'));

    const impossible = response();
    sendFile(impossible, Buffer.from('abcdef'), 'audio/mpeg', 'voz.mp3', 'bytes=9-10');
    expect(impossible.writeHead).toHaveBeenCalledWith(200, expect.anything());
    expect(impossible.end).toHaveBeenCalledWith(Buffer.from('abcdef'));
  });
});
