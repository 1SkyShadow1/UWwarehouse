import importlib.util, tempfile, unittest
from pathlib import Path
import openpyxl
spec=importlib.util.spec_from_file_location('recovery',Path(__file__).with_name('recover-imported-quotes.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class QuoteExtractionTests(unittest.TestCase):
    def test_rows_continuations_unknown_rates_and_total(self):
        with tempfile.TemporaryDirectory() as directory:
            book=openpyxl.Workbook();s=book.active
            for row in [['Client contact name','Test client'],['Introduction, notes and specifications'],['Original work and supplied fabric'],['Quote line items'],['Description','Qty','Unit Price','Total Price'],['Sofa',2,100,200],['Including velvet',None,None,0],['OR',None,None,0],['Chair',1,50,50],['Unpriced repair',1,None,0],['TOTAL',None,None,250]]:s.append(row)
            p=Path(directory)/'quote.xlsx';book.save(p);result,audit=module.extract(p)
            self.assertEqual(result['customer'],'Test client');self.assertEqual(result['introduction'],'Original work and supplied fabric');self.assertEqual(result['items'][0]['desc'],'Sofa\nIncluding velvet');self.assertEqual(result['items'][1]['desc'],'OR\nChair');self.assertEqual(result['items'][2]['price'],'');self.assertEqual(audit['lineTotal'],250);self.assertEqual(len(audit['warnings']),2)
    def test_mismatched_line_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            book=openpyxl.Workbook();s=book.active
            for row in [['Quote line items'],['Description','Qty','Unit Price','Total Price'],['Fabric',2,100,300]]:s.append(row)
            p=Path(directory)/'quote.xlsx';book.save(p)
            with self.assertRaisesRegex(ValueError,'Line total mismatch'):module.extract(p)
if __name__=='__main__':unittest.main()
