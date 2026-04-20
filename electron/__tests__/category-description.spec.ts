import { preserveCategoryDescriptions } from '../../src/app/components/shared/category-description.util';

describe('category description preservation', () => {
  test('copies normal description into Andet when Andet text is empty', () => {
    const next = preserveCategoryDescriptions('Andet', 'Typed text', '');
    expect(next).toEqual({ description: 'Typed text', andetDescription: 'Typed text' });
  });

  test('keeps existing Andet text when switching to Andet', () => {
    const next = preserveCategoryDescriptions('Andet', 'Typed text', 'Already set');
    expect(next).toEqual({ description: 'Typed text', andetDescription: 'Already set' });
  });

  test('copies Andet text back when leaving Andet and base description is empty', () => {
    const next = preserveCategoryDescriptions('Møde', '', 'Already set');
    expect(next).toEqual({ description: 'Already set', andetDescription: 'Already set' });
  });
});
