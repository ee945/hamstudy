# -*- coding: utf-8 -*-
"""兼容入口：收紧题库权限（三级角色 + 待审表 + 修订日志表）。

历史上这里只做「hs_edits 仅管理员可写」。现在完整的工作流定义集中在
setup_workflow.py，本脚本保留为同义入口，避免旧文档 / 旧习惯里的命令失效。

用法：先启动 PocketBase，再 `python3 tools/setup_roles.py`
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from setup_workflow import main  # noqa: E402

if __name__ == "__main__":
    main()
