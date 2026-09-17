import { describe, expect, it } from 'vitest'
import { safeReportLink } from './cveScanLinks'

describe('safeReportLink', () => {
  it('keeps an absolute http(s) report link as it is', () => {
    const link = 'https://cvescan.corp.example:9443/?report=cve_scan_web-01_20260917T080000Z.json'
    expect(safeReportLink(link)).toBe(link)
    expect(safeReportLink('http://10.100.21.206:9080/?report=a.json')).toBe('http://10.100.21.206:9080/?report=a.json')
  })

  it('refuses anything that could not be a plain link', () => {
    for (const bad of [
      undefined,
      '',
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'ftp://cvescan.corp.example/report',
      '/relative/report',
      'https://cvescan.corp.example/a b',
      'https://user:pass@cvescan.corp.example/',
      'https://cvescan.corp.example/réport',
      'https://cvescan.corp.example/' + 'a'.repeat(2048),
    ]) {
      expect(safeReportLink(bad), String(bad)).toBeNull()
    }
  })
})
