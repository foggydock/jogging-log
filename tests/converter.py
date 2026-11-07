import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

path = Path(__file__).resolve().parents[1] / 'tools' / 'convert_notion.py'
spec = importlib.util.spec_from_file_location('converter', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConverterTest(unittest.TestCase):
    def test_dates(self):
        self.assertIsNone(module.parse_date('2026-02-30'))
        self.assertEqual(module.parse_date('2024年2月29日'), '2024-02-29')

    def test_duration(self):
        for value in ['1::30', '1:99', '-1:20', '24:00:01', '0:90:00']:
            self.assertIsNone(module.parse_duration(value))
        self.assertEqual(module.parse_duration('29:30'), 1770)

    def test_empty_and_nonfinite(self):
        with tempfile.TemporaryDirectory() as directory:
            src, dst = Path(directory)/'dummy.csv', Path(directory)/'dummy.json'
            for rows in ['', 'dummy,2026-01-01,NaN,Infinity\n']:
                src.write_text('Name,日付,距離(km),ワークアウト時間(分)\n'+rows)
                result = subprocess.run(['python3', str(path), str(src), str(dst)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(dst.read_text())['runs'], [])


if __name__ == '__main__':
    unittest.main()
