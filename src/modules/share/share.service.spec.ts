import { ShareService } from './share.service';

describe('ShareService', () => {
  function setup(rowsBySql: (sql: string) => Array<Record<string, unknown>>) {
    const query = jest.fn((sql: string) => Promise.resolve(rowsBySql(sql)));
    const service = new ShareService({ query } as never);
    return { service, query };
  }

  const group = {
    id: 'g-1',
    name: 'Runners',
    isPublic: true,
    isActive: true,
    memberCount: 2,
  };

  it('asks one query per type, whatever the number of refs', async () => {
    const { service, query } = setup((sql) =>
      sql.includes('"group"') ? [group] : [],
    );

    const cards = await service.cardsFor([
      { type: 'GROUP', id: 'g-1' },
      { type: 'GROUP', id: 'g-2' },
      { type: 'EXERCISE', id: 'e-1' },
    ]);

    expect(query).toHaveBeenCalledTimes(2);
    expect(cards.get('GROUP:g-1')).toMatchObject({
      state: 'AVAILABLE',
      name: 'Runners',
    });
    // Missing rows read as unavailable, never as an error.
    expect(cards.get('GROUP:g-2')).toEqual({
      type: 'GROUP',
      state: 'UNAVAILABLE',
      name: null,
    });
    expect(cards.get('EXERCISE:e-1')?.state).toBe('UNAVAILABLE');
  });

  it('asks nothing for nothing', async () => {
    const { service, query } = setup(() => []);
    expect((await service.cardsFor([])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('only what is public and not over can be sent', async () => {
    const { service } = setup((sql) =>
      sql.includes('"group"') ? [group] : [],
    );
    expect(
      await service.shareableCard({ type: 'GROUP', id: 'g-1' }),
    ).toMatchObject({
      name: 'Runners',
    });
    expect(
      await service.shareableCard({ type: 'GROUP', id: 'nope' }),
    ).toBeNull();
  });
});
