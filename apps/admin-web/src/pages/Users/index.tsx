/**
 * 用户管理页面
 *
 * 功能：
 * - 用户列表（姓名、角色、城市、状态、注册时间、最后登录）
 * - 启用/禁用切换
 */
import { Table, Tag, Switch, Button, Space, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as usersApi from '@/api/users.api';
import type { UserListItem } from '@biz-reporting/shared-types';
import { UserStatus, Role } from '@biz-reporting/shared-types';

export default function Users() {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.listUsers,
  });

  const statusMutation = useMutation({
    mutationFn: ({
      userId,
      status,
    }: {
      userId: number;
      status: UserStatus;
    }) => usersApi.updateUserStatus(userId, { status }),
    onSuccess: () => {
      message.success('状态更新成功');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const users = data?.items ?? [];

  const roleLabels: Record<string, string> = {
    [Role.SYSTEM_ADMIN]: '系统管理员',
    [Role.CITY_USER]: '城市用户',
  };

  const columns = [
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 120,
      render: (role: string) => (
        <Tag color={role === Role.SYSTEM_ADMIN ? 'red' : 'blue'}>
          {roleLabels[role] || role}
        </Tag>
      ),
    },
    {
      title: '关联城市',
      key: 'city',
      width: 120,
      render: (_: any, record: UserListItem) =>
        record.cityName || (record.cityId ? `城市 #${record.cityId}` : '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: UserStatus, record: UserListItem) => (
        <Switch
          checked={status === UserStatus.ENABLED}
          checkedChildren="启用"
          unCheckedChildren="禁用"
          loading={
            statusMutation.isPending &&
            statusMutation.variables?.userId === record.id
          }
          onChange={(checked) =>
            statusMutation.mutate({
              userId: record.id,
              status: checked ? UserStatus.ENABLED : UserStatus.DISABLED,
            })
          }
        />
      ),
    },
    {
      title: '注册时间',
      dataIndex: 'registerAt',
      key: 'registerAt',
      width: 180,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '最后登录',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      width: 180,
      render: (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '从未登录'),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isLoading}>
          刷新
        </Button>
      </div>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={users}
        loading={isLoading}
        pagination={{ showTotal: (total) => `共 ${total} 位用户`, pageSize: 20 }}
        locale={{ emptyText: '暂无用户数据' }}
      />
    </div>
  );
}
