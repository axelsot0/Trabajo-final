from tkinter import *


import sqlite3

con = sqlite3.connect("mydb.db")
cursor = con.cursor()
query0 = """
CREATE TABLE  contactos(contactoid integer primary key autoincrement, nombrecontacto text, numerocontacto integer, correocontacto text); """

query2 = """ SELECT * FROM contactos; """



ventana = Tk()
ventana.title("Agenda VyperCode")

#funciones tkinter
def click_boton(valor):
    global i
    e_texto.insert(i, valor)
    i += 1

#funciones
def insertar (nombrecontacto,numerocontacto,correocontacto):
   query1 = """ INSERT INTO contactos(nombrecontacto, numerocontacto, correocontacto) VALUES (?,?,?); """
   info_tupla = (nombrecontacto,numerocontacto,correocontacto)
   cursor.execute(query1, info_tupla)
   con.commit()
   print("Datos Guardados")

def busquedanombre(nombrecontacto):
    query3 = """ SELECT *  FROM contactos WHERE nombrecontacto = ? """
    cursor.execute(query3, (nombrecontacto,))
    res = cursor.fetchall()
    print(res)

def busquedanumero(numerocontacto):
    query4 = """ SELECT * FROM contactos WHERE numerocontacto = ? """
    cursor.execute(query4, (numerocontacto,))
    res = cursor.fetchall()
    print(res)

def borrar_Cont(nombrecontacto):
    query4 ="""DELETE FROM contactos WHERE nombrecontacto = ? """
    cursor.execute(query4, (nombrecontacto,))

def actualizarcontacto(nombrecontacto,numerocontacto,correocontacto,contactoid):
   query6 = """ UPDATE  contactos SET nombrecontacto = ?, numerocontacto = ?, correocontacto = ? where contactoid = ?; """
   cursor.execute(query6,[nombrecontacto,numerocontacto,correocontacto,contactoid])
   con.commit()

#Botones

boton1 = Button(ventana, text = "1", width = 5, height = 2 , command = lambda: click_boton(1))
boton2 = Button(ventana, text = "2", width = 5, height = 2 ,command = lambda: click_boton(2))
boton3 = Button(ventana, text = "3", width = 5, height = 2 ,command = lambda: click_boton(3))
boton4 = Button(ventana, text = "4", width = 5, height = 2 ,command = lambda: click_boton(4))
boton5 = Button(ventana, text = "5", width = 5, height = 2 ,command = lambda: click_boton(5))
boton6 = Button(ventana, text = "6", width = 5, height = 2 ,command = lambda: click_boton(6))
boton7 = Button(ventana, text = "7", width = 5, height = 2 ,command = lambda: click_boton(7))
boton8 = Button(ventana, text = "8", width = 5, height = 2 , command = lambda: click_boton(8))
boton9 = Button(ventana, text = "9", width = 5, height = 2 ,command = lambda: click_boton(9))
boton0 = Button(ventana, text = "0", width = 15 , height = 2 , command = lambda: click_boton(0))


# boton_borrar  = Button(ventana, text = "AC", width = 5, height = 2, bg="#ff0000" ,command = lambda: borrar())
# boton_parentesis1 = Button(ventana, text = "(", width = 5, height = 2,command = lambda: click_boton("("))
# boton_parentesis2 = Button(ventana, text = ")", width = 5, height = 2 ,command = lambda: click_boton(")"))
# boton_punto = Button(ventana, text = ".", width = 5, height = 2 ,command = lambda: click_boton("."))
# boton_div = Button(ventana, text = "/", width = 5, height = 2 ,command = lambda: click_boton("/"))
# boton_mult = Button(ventana, text = "X", width = 5, height = 2 , command = lambda: click_boton("*"))
# boton_rest = Button(ventana, text = "-", width = 5, height = 2 , command = lambda: click_boton("-"))
# boton_sum = Button(ventana, text = "+", width = 5, height = 2 ,command = lambda: click_boton("+"))
# boton_igual = Button(ventana, text = " = ", width = 5, height = 2 ,command = lambda:hacer_operacion())



mainloop()
