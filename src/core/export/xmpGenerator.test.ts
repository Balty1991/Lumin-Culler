import { describe, expect, it } from 'vitest';
import { generateXMPSidecar, deriveXmpKeywords } from './xmpGenerator';

describe('generateXMPSidecar', () => {
  it('uses the manual star rating when present', () => {
    expect(generateXMPSidecar('selected', 3)).toContain('xmp:Rating="3"');
  });

  it('falls back to the status convention when no manual rating exists', () => {
    expect(generateXMPSidecar('selected')).toContain('xmp:Rating="5"');
    expect(generateXMPSidecar('review')).toContain('xmp:Rating="0"');
  });

  it('ignores a 0 rating (treated as "no rating"), falling back to the status convention', () => {
    expect(generateXMPSidecar('selected', 0)).toContain('xmp:Rating="5"');
  });

  it('a rejected photo always gets -1, even with a leftover star rating', () => {
    const xmp = generateXMPSidecar('rejected', 4);
    expect(xmp).toContain('xmp:Rating="-1"');
    expect(xmp).not.toContain('xmp:Rating="4"');
  });

  it('always writes the status color label regardless of rating', () => {
    expect(generateXMPSidecar('selected', 2)).toContain('xmp:Label="Green"');
    expect(generateXMPSidecar('rejected', 2)).toContain('xmp:Label="Red"');
  });

  it('omits dc:subject entirely when there are no keywords', () => {
    expect(generateXMPSidecar('selected', 3)).not.toContain('dc:subject');
  });

  it('writes each keyword as an rdf:li inside dc:subject/rdf:Bag', () => {
    const xmp = generateXMPSidecar('selected', 3, ['Ami', 'Portret copil']);
    expect(xmp).toContain('<dc:subject>');
    expect(xmp).toContain('<rdf:li>Ami</rdf:li>');
    expect(xmp).toContain('<rdf:li>Portret copil</rdf:li>');
  });

  it('escapes XML-sensitive characters in keywords', () => {
    const xmp = generateXMPSidecar('selected', 3, ['Tom & Jerry <2>']);
    expect(xmp).toContain('Tom &amp; Jerry &lt;2&gt;');
    expect(xmp).not.toContain('Tom & Jerry <2>');
  });
});

describe('deriveXmpKeywords', () => {
  it('includes known person names', () => {
    expect(deriveXmpKeywords(['Ami', 'Radu'], undefined)).toEqual(['Ami', 'Radu']);
  });

  it('appends the Romanian scene label when recognized', () => {
    expect(deriveXmpKeywords([], 'child_portrait')).toEqual(['Portret copil']);
    expect(deriveXmpKeywords(['Ami'], 'family_group')).toEqual(['Ami', 'Grup familie']);
  });

  it('ignores an unrecognized scene semantic', () => {
    expect(deriveXmpKeywords(['Ami'], 'something_unknown')).toEqual(['Ami']);
  });
});
