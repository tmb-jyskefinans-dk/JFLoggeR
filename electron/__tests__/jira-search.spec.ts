import { mapAndRankJiraIssues } from '../jira-search';

describe('mapAndRankJiraIssues', () => {
  it('prioritizes roles as assignee, co-assignee, reporter, then others', () => {
    const issues = [
      {
        key: 'TEAM-4',
        fields: {
          summary: 'Other issue',
          assignee: { accountId: 'user-other', displayName: 'Other User' },
          reporter: { accountId: 'user-other', displayName: 'Other User' },
          customfield_10060: []
        }
      },
      {
        key: 'TEAM-3',
        fields: {
          summary: 'Reporter match issue',
          reporter: { accountId: 'user-me', displayName: 'Me User' },
          customfield_10060: []
        }
      },
      {
        key: 'TEAM-2',
        fields: {
          summary: 'Co-assigned match issue',
          customfield_10060: [{ accountId: 'user-me', displayName: 'Me User' }]
        }
      },
      {
        key: 'TEAM-1',
        fields: {
          summary: 'Assigned to me issue',
          assignee: { accountId: 'user-me', displayName: 'Me User' },
          customfield_10060: []
        }
      }
    ];

    const ranked = mapAndRankJiraIssues(issues, 'TEAM', 'user-me');
    expect(ranked.map((item) => item.key)).toEqual(['TEAM-1', 'TEAM-2', 'TEAM-3', 'TEAM-4']);

    expect(ranked[0].isCurrentUserAssignee).toBe(true);
    expect(ranked[1].isCurrentUserCoAssignee).toBe(true);
    expect(ranked[2].isCurrentUserReporter).toBe(true);
  });

  it('uses relevance tie-break within the same role group', () => {
    const issues = [
      {
        key: 'TEAM-200',
        fields: {
          summary: 'TEAM migration work',
          assignee: { accountId: 'user-other', displayName: 'Other User' }
        }
      },
      {
        key: 'TEAM-123',
        fields: {
          summary: 'Some unrelated summary',
          assignee: { accountId: 'user-other', displayName: 'Other User' }
        }
      },
      {
        key: 'ABC-999',
        fields: {
          summary: 'TEAM rollout',
          assignee: { accountId: 'user-other', displayName: 'Other User' }
        }
      }
    ];

    const ranked = mapAndRankJiraIssues(issues, 'TEAM-123', 'user-me');
    expect(ranked.map((item) => item.key)).toEqual(['TEAM-123', 'TEAM-200', 'ABC-999']);
  });

  it('maps multi-user co-assignee custom field to ids and names', () => {
    const issues = [
      {
        key: 'TEAM-88',
        fields: {
          summary: 'Multi user custom field mapping',
          customfield_10060: [
            { accountId: 'user-1', displayName: 'User One' },
            { accountId: 'user-2', displayName: 'User Two' }
          ]
        }
      }
    ];

    const ranked = mapAndRankJiraIssues(issues, 'TEAM', 'user-2');
    expect(ranked.length).toBe(1);
    expect(ranked[0].coAssigneeAccountIds).toEqual(['user-1', 'user-2']);
    expect(ranked[0].coAssigneeDisplayNames).toEqual(['User One', 'User Two']);
    expect(ranked[0].isCurrentUserCoAssignee).toBe(true);
  });
});
