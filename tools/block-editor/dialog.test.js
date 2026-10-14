/* eslint-disable import/extensions */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBlockName, pickVariant, cellToValue, valueToCell, readValues, buildTableHtml,
} from './dialog.js';

const cards = { variants: [{ name: 'default', row: { label: 'Card', cells: [{ name: 'image', type: 'image' }, { name: 'body', type: 'richtext' }] } }] };
const hero = {
  variants: [
    { name: 'default', rows: [{ name: 'image', type: 'image' }, { name: 'content', type: 'richtext' }] },
    { name: 'both', rows: [{ name: 't', type: 'text' }], row: { label: 'X', cells: [{ name: 'a', type: 'text' }] } },
    { name: 'empty' },
  ],
};

test('parseBlockName', () => {
  assert.deepEqual(parseBlockName('hero (center)'), { block: 'hero', variant: 'center' });
  assert.deepEqual(parseBlockName('cards'), { block: 'cards', variant: 'default' });
  assert.deepEqual(parseBlockName(' Hero (Center) '), { block: 'hero', variant: 'center' });
  assert.deepEqual(parseBlockName('hero(center)'), { block: 'hero', variant: 'center' });
});

test('pickVariant', () => {
  assert.equal(pickVariant(hero, 'nope').variant.name, 'default');
  assert.equal(pickVariant(hero, 'both').variant.mode, 'rows');
  assert.equal(pickVariant(cards, 'default').variant.mode, 'row');
  assert.equal(pickVariant(cards, 'default').variant.label, 'Card');
  assert.equal(pickVariant(hero, 'empty').error, 'Variant "empty" defines no rows.');
  assert.equal(pickVariant({ variants: [{ name: 'a', rows: [] }] }, 'x').error, 'Variant "x" is not defined.');
});

test('cell conversions', () => {
  assert.equal(valueToCell('text', 'a<b & c'), 'a&lt;b &amp; c');
  assert.equal(valueToCell('image', 'u.png'), '<img src="u.png">');
  assert.equal(valueToCell('image', ''), '');
  assert.equal(valueToCell('richtext', '<p>x</p>'), '<p>x</p>');
  assert.equal(cellToValue('text', '<p>a &amp; b</p>'), 'a & b');
  assert.equal(cellToValue('image', '<picture><img src="x.jpg" alt=""></picture>'), 'x.jpg');
  assert.equal(cellToValue('image', 'none'), '');
});

test('review fixes', () => {
  assert.equal(cellToValue('text', '<p>a</p><p>b</p>'), 'a b');
  assert.equal(cellToValue('text', 'it&#8217;s &#x41;'), 'it\u2019s A');
  const pic = '<picture><source srcset="x.webp"><img src="x.jpg" alt="Alt"></picture>';
  assert.equal(valueToCell('image', pic), pic);
  const fixed = pickVariant(hero, 'default').variant;
  assert.deepEqual(readValues(fixed, [[pic], ['']]), [pic, '']);
});

test('readValues', () => {
  const fixed = pickVariant(hero, 'default').variant;
  assert.deepEqual(readValues(fixed, [['<img src="a">'], []]), ['<img src="a">', '']);
  const rep = pickVariant(cards, 'default').variant;
  assert.deepEqual(readValues(rep, []), [['', '']]);
  assert.deepEqual(readValues(rep, [['<img src="a">']]), [['<img src="a">', '']]);
});

test('buildTableHtml', () => {
  const rep = pickVariant(cards, 'default').variant;
  const html = buildTableHtml('cards', rep, [['a', '<p>b</p>'], ['', 'c']]);
  assert.equal(html, '<table><tr><td colspan="2">cards</td></tr><tr><td><img src="a"></td><td><p>b</p></td></tr><tr><td></td><td>c</td></tr></table>');
  const fixed = pickVariant(hero, 'default').variant;
  assert.match(buildTableHtml('hero', fixed, ['', 'x']), /^<table><tr><td colspan="1">hero<\/td><\/tr><tr><td><\/td><\/tr><tr><td>x<\/td><\/tr><\/table>$/);
});
