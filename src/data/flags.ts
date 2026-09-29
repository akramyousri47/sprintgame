/**
 * Procedural flags for the invented nations. Drawn to a canvas so the HUD can
 * use them as <img> sources and the stadium screen can blit them, with no
 * external image assets anywhere in the project.
 */

import type { Nation } from './athletes';

const cache = new Map<string, string>();

export function flagDataUrl(nation: Nation, w = 96, h = 64): string {
  const key = `${nation.code}:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const [a, b, d] = nation.colors;

  g.fillStyle = a;
  g.fillRect(0, 0, w, h);

  switch (nation.pattern) {
    case 'triband': {
      const third = h / 3;
      g.fillStyle = b;
      g.fillRect(0, 0, w, third);
      g.fillStyle = d;
      g.fillRect(0, third * 2, w, third);
      break;
    }
    case 'stripes-h': {
      const n = 5;
      for (let i = 0; i < n; i += 2) {
        g.fillStyle = b;
        g.fillRect(0, (i * h) / n, w, h / n);
      }
      g.fillStyle = d;
      g.fillRect(0, h * 0.44, w, h * 0.12);
      break;
    }
    case 'stripes-v': {
      const n = 6;
      for (let i = 0; i < n; i += 2) {
        g.fillStyle = b;
        g.fillRect((i * w) / n, 0, w / n, h);
      }
      g.fillStyle = d;
      g.fillRect(w * 0.44, 0, w * 0.12, h);
      break;
    }
    case 'diagonal': {
      g.fillStyle = b;
      g.beginPath();
      g.moveTo(0, h);
      g.lineTo(w, 0);
      g.lineTo(w, h * 0.42);
      g.lineTo(0, h);
      g.closePath();
      g.fill();
      g.fillStyle = d;
      g.beginPath();
      g.moveTo(0, h);
      g.lineTo(w, 0);
      g.lineTo(w, h * 0.2);
      g.lineTo(0, h);
      g.closePath();
      g.fill();
      break;
    }
    case 'cross': {
      const t = h * 0.22;
      g.fillStyle = b;
      g.fillRect(0, h / 2 - t / 2, w, t);
      g.fillRect(w / 2 - t / 2, 0, t, h);
      g.fillStyle = d;
      g.fillRect(w * 0.68, h * 0.2, w * 0.14, h * 0.14);
      break;
    }
    case 'disc': {
      g.fillStyle = b;
      g.beginPath();
      g.arc(w * 0.5, h * 0.5, h * 0.3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = d;
      g.beginPath();
      g.arc(w * 0.5, h * 0.5, h * 0.13, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'chevron': {
      g.fillStyle = b;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(w * 0.42, 0);
      g.lineTo(w * 0.2, h / 2);
      g.lineTo(w * 0.42, h);
      g.lineTo(0, h);
      g.closePath();
      g.fill();
      g.fillStyle = d;
      g.beginPath();
      g.moveTo(w * 0.52, 0);
      g.lineTo(w * 0.78, 0);
      g.lineTo(w * 0.56, h / 2);
      g.lineTo(w * 0.78, h);
      g.lineTo(w * 0.52, h);
      g.closePath();
      g.fill();
      break;
    }
    case 'halved': {
      g.fillStyle = b;
      g.fillRect(0, h / 2, w, h / 2);
      g.fillStyle = d;
      g.beginPath();
      g.arc(w * 0.5, h * 0.5, h * 0.22, 0, Math.PI * 2);
      g.fill();
      break;
    }
  }

  // subtle cloth shading so the flag does not read as flat vector art
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
